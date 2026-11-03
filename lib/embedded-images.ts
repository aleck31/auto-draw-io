/**
 * Pictures embedded in a diagram, as the model sees them.
 *
 * A picture pasted into draw.io is kept in its cell's style as the whole file
 * in base64 (image=data:image/png,iVBOR...), often hundreds of thousands of
 * characters. The model needs none of it, and the canvas it is shown stays in
 * the conversation, so hideImageData writes each picture as a short reference,
 * the same one every time for the same picture:
 *
 *   image=data:image/png,embedded-image-1k2j3h4g5f6d
 *
 * restoreImageData puts the pictures back into the XML the model writes, from
 * the diagrams it is given (the one the XML is drawn on) and, in the browser,
 * the canvases passed to rememberImages, so a reference to a picture of an
 * earlier version of the diagram still works. The server passes its sources
 * explicitly and remembers nothing, so a long-running process holds no images.
 *
 * Adapted from next-ai-draw-io (packages/mcp-server/src/embedded-images.ts,
 * Apache-2.0).
 */

// Shorter data stays as it is: a reference would save little
const IMAGE_DATA =
    /(data:image\/[\w.+-]+(?:;base64)?,)([A-Za-z0-9+/]{200,}={0,2})/g
const IMAGE_REF_PREFIX = "embedded-image-"
const IMAGE_REF = /embedded-image-([0-9a-z]+)/g

// cyrb53, a fast 53-bit string hash with the same result in Node and the
// browser, so the server and the canvas name a picture alike
function imageId(data: string): string {
    let h1 = 0xdeadbeef
    let h2 = 0x41c6ce57
    for (let i = 0; i < data.length; i++) {
        const c = data.charCodeAt(i)
        h1 = Math.imul(h1 ^ c, 2654435761)
        h2 = Math.imul(h2 ^ c, 1597334677)
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507)
    h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909)
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507)
    h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909)
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
}

/** Each embedded picture's data replaced by its reference */
export function hideImageData(xml: string): string {
    if (!xml.includes("data:image/")) return xml
    return xml.replace(
        IMAGE_DATA,
        (_, prefix: string, data: string) =>
            `${prefix}${IMAGE_REF_PREFIX}${imageId(data)}`,
    )
}

/** What the model is told with XML shown by hideImageData, or "" when it has no references */
export function imageRefNote(shown: string): string {
    return shown.includes(IMAGE_REF_PREFIX)
        ? `Pictures embedded in the diagram are shown as references (data:image/...,${IMAGE_REF_PREFIX}<id>). Keep a reference exactly as written to keep its picture, also when you redraw the whole diagram: the picture is put back when your XML is drawn.`
        : ""
}

function collectImages(xml: string, into: Map<string, string>): void {
    if (!xml.includes("data:image/")) return
    for (const m of xml.matchAll(IMAGE_DATA)) {
        const id = imageId(m[2])
        if (!into.has(id)) into.set(id, m[2])
    }
}

// Browser only: the pictures of the canvases sent to the model this session
const remembered = new Map<string, string>()
let lastRemembered = ""

/** Keep a canvas's pictures for restoreImageData (the browser calls this) */
export function rememberImages(xml: string | null | undefined): void {
    if (!xml || xml === lastRemembered) return
    lastRemembered = xml
    collectImages(xml, remembered)
}

/**
 * The references in `xml` replaced by their pictures, taken from `sources`
 * (the diagrams the XML is drawn on or derived from) and the remembered
 * canvases. A reference to a picture in neither stays as written.
 */
export function restoreImageData(
    xml: string,
    ...sources: (string | null | undefined)[]
): string {
    if (!xml.includes(IMAGE_REF_PREFIX)) return xml
    const images = new Map<string, string>()
    for (const source of sources) if (source) collectImages(source, images)
    return xml.replace(
        IMAGE_REF,
        (ref, id: string) => images.get(id) ?? remembered.get(id) ?? ref,
    )
}

/** Edit operations with the pictures in their new_xml restored (see restoreImageData) */
export function restoreOperationImages<T extends { new_xml?: string }>(
    operations: T[],
    ...sources: (string | null | undefined)[]
): T[] {
    return operations.map((op) =>
        op.new_xml?.includes(IMAGE_REF_PREFIX)
            ? { ...op, new_xml: restoreImageData(op.new_xml, ...sources) }
            : op,
    )
}
