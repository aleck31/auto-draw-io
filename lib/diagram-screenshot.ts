/**
 * Screenshots of the canvas sent back to the model, so it can see what it
 * drew. The diagram tools return { message, image } when a screenshot was
 * taken; the image is a PNG data URL.
 *
 * Only the latest screenshot of a conversation is sent as an image: older
 * ones are replaced by a note before the messages leave the browser, are
 * stored, or reach the model, so images don't pile up in the context.
 */

/** Widths tried in order; the first image under the size cap wins */
const SCREENSHOT_WIDTHS = [1000, 700]
/** Base64 length cap, about 100 KB of PNG */
const MAX_SCREENSHOT_CHARS = 140_000

export const SCREENSHOT_CHECKLIST = `Check this rendering of the diagram for:
1. Overlapping shapes that cover each other or their labels (critical)
2. Edges crossing shapes that are not their source or target (critical)
3. Text that is cut off, overlapping or too small to read (warning)
4. Layout problems: cramped shapes, poor spacing or misalignment (warning)
5. Rendering errors: missing, incomplete or broken elements, such as an icon that did not load (critical)
6. Labels on top of lines or shape borders, arrowheads ending on text or icons, edges crossing other edges (warning)
Name the elements that have a problem, for example "the 'Login' box overlaps 'Register'". If there are critical issues, fix them with edit_diagram (screenshot: true) and check again; fix the warnings in the same round when you can. Do at most two rounds of fixes. Diagrams with only 1 or 2 shapes pass unless something is clearly broken. Do not tell the user the check passed while problems remain: name the ones you left.
Reply to the user in the language they write in (their latest message), not the language of this checklist.`

const OMITTED_NOTE =
    "[Screenshot omitted: only the latest screenshot is kept in the conversation.]"

export interface ScreenshotOutput {
    message: string
    image?: string
    imageOmitted?: true
}

function isScreenshotOutput(value: unknown): value is ScreenshotOutput {
    return (
        !!value &&
        typeof value === "object" &&
        typeof (value as ScreenshotOutput).message === "string"
    )
}

/**
 * The PNG scaled down to the first width in SCREENSHOT_WIDTHS whose data
 * URL fits the cap (or the smallest one). Browser only.
 */
export async function shrinkScreenshot(dataUrl: string): Promise<string> {
    const img = new Image()
    await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve()
        img.onerror = () =>
            reject(new Error("The screenshot could not be read"))
        img.src = dataUrl
    })
    let result = dataUrl
    for (const width of SCREENSHOT_WIDTHS) {
        const scale = Math.min(1, width / img.naturalWidth)
        const canvas = document.createElement("canvas")
        canvas.width = Math.max(1, Math.round(img.naturalWidth * scale))
        canvas.height = Math.max(1, Math.round(img.naturalHeight * scale))
        const ctx = canvas.getContext("2d")
        if (!ctx) break
        // draw.io's PNG export is transparent; the model sees it on white
        ctx.fillStyle = "#ffffff"
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        result = canvas.toDataURL("image/png")
        if (result.length <= MAX_SCREENSHOT_CHARS) break
    }
    return result
}

/** toModelOutput of the diagram tools: a screenshot becomes an image part */
export function diagramToolModelOutput({ output }: { output: unknown }) {
    if (typeof output === "string") {
        return { type: "text" as const, value: output }
    }
    if (isScreenshotOutput(output)) {
        const match = output.image?.match(
            /^data:(image\/[\w+.-]+);base64,(.+)$/,
        )
        if (match) {
            return {
                type: "content" as const,
                value: [
                    { type: "text" as const, text: output.message },
                    {
                        type: "file" as const,
                        data: { type: "data" as const, data: match[2] },
                        mediaType: match[1],
                    },
                    { type: "text" as const, text: SCREENSHOT_CHECKLIST },
                ],
            }
        }
        return {
            type: "text" as const,
            value: output.imageOmitted
                ? `${output.message}\n${OMITTED_NOTE}`
                : output.message,
        }
    }
    return {
        type: "text" as const,
        value: output === undefined ? "" : JSON.stringify(output),
    }
}

/** The messages with every screenshot but the latest replaced by a note */
export function keepLatestScreenshot<T extends { parts?: unknown[] }>(
    messages: T[],
): T[] {
    let latestSeen = false
    const result = [...messages]
    for (let m = result.length - 1; m >= 0; m--) {
        const parts = result[m].parts
        if (!Array.isArray(parts)) continue
        let changed = false
        const nextParts = [...parts]
        for (let p = nextParts.length - 1; p >= 0; p--) {
            const part = nextParts[p] as { output?: unknown }
            if (!isScreenshotOutput(part?.output) || !part.output.image)
                continue
            if (!latestSeen) {
                latestSeen = true
                continue
            }
            const { image: _image, ...rest } = part.output
            nextParts[p] = {
                ...part,
                output: { ...rest, imageOmitted: true },
            }
            changed = true
        }
        if (changed) result[m] = { ...result[m], parts: nextParts }
    }
    return result
}
