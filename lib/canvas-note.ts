/**
 * What a user message tells the model about the canvas, and how older
 * messages are trimmed before they go to the model.
 *
 * Each user message records in its metadata either the canvas when it was
 * sent, or that the canvas was unchanged (the model knows it from the last
 * canvas it was shown plus its own calls since). The server turns that into
 * the same text in every request, so the history stays identical from
 * request to request and the provider's prompt cache can reuse it.
 *
 * Adapted from next-ai-draw-io (#1024: lib/diagram-context.ts and
 * lib/chat-helpers.ts, Apache-2.0).
 */

export type CanvasNote = { xml: string; pages?: string[] } | { unchanged: true }

const LANGUAGE_NOTE =
    "Write your reply in the language of the user's own words in this message, not in the language of the diagram, attached files or this note."

function pagesText(pages: string[] | undefined): string {
    if (!pages || pages.length < 2) return ""
    const list = pages
        .slice(0, 50)
        .map(
            (name, i) =>
                `${i + 1}. ${JSON.stringify(String(name).slice(0, 100))}`,
        )
        .join(", ")
    return ` This file has ${pages.length} pages: ${list}. The XML is page 1 only, and your display_diagram, edit_diagram and append_diagram calls change page 1 only; the other pages are kept unchanged and you cannot see or edit them. If the user asks about another page, tell them you can only work on the first page for now.`
}

/** The note appended to a user message, from its metadata */
export function canvasNoteText(note: CanvasNote | undefined): string {
    if (!note) return LANGUAGE_NOTE
    if ("unchanged" in note) {
        return `[Canvas: unchanged when this message was sent. It is the latest canvas shown in an earlier note, with your display_diagram and edit_diagram calls since then applied.]\n\n${LANGUAGE_NOTE}`
    }
    const xml = note.xml?.trim() ?? ""
    if (!/<mxCell\b[^>]*\b(vertex|edge)="1"/.test(xml)) {
        return `[Canvas: empty when this message was sent.${pagesText(note.pages)}]\n\n${LANGUAGE_NOTE}`
    }
    return `[Canvas when this message was sent. It is the source of truth from this point on and shows any change the user made by hand; take cell ids for edit_diagram from it.${pagesText(note.pages)}]\n"""xml\n${xml}\n"""\n\n${LANGUAGE_NOTE}`
}

// The text of a document the user attached: the client adds
// "\n\n[PDF: name]\n<text>" ("File" alike) after the typed text. The name
// may contain "]": the heading ends with the last one on its line.
const ATTACHED_TEXT =
    /(\n\n\[(?:PDF|File): [^\n]*\])\n[\s\S]*?(?=\n\n\[(?:PDF|File): |$)/g

const isImagePart = (part: { type?: string; mediaType?: string }) =>
    part.type === "file" && String(part.mediaType ?? "").startsWith("image/")

type UIMessageLike = { role: string; parts?: any[]; metadata?: unknown }

/**
 * An attached document or image goes to the model with its own turn only:
 * user messages before the newest one keep just a document's name line and
 * leave their images out. The newest message keeps everything, also in the
 * automatic requests of its turn (tool results, retries).
 */
export function withoutOldAttachments<T extends UIMessageLike>(
    messages: T[],
): T[] {
    let newest = -1
    messages.forEach((m, i) => {
        if (m.role === "user") newest = i
    })
    return messages.map((message, i) => {
        if (message.role !== "user" || i === newest || !message.parts) {
            return message
        }
        return {
            ...message,
            parts: message.parts
                .filter((part) => !isImagePart(part))
                .map((part) =>
                    part.type === "text" && typeof part.text === "string"
                        ? {
                              ...part,
                              text: part.text.replace(ATTACHED_TEXT, "$1"),
                          }
                        : part,
                ),
        }
    })
}

/**
 * Each user message with its canvas note appended as a separate text part.
 * A message from before canvas notes has none: the newest one then gets the
 * canvas of the request, the older ones only the language note.
 */
export function withCanvasNotes<T extends UIMessageLike>(
    messages: T[],
    requestCanvas: CanvasNote | undefined,
): T[] {
    let newest = -1
    messages.forEach((m, i) => {
        if (m.role === "user") newest = i
    })
    return messages.map((message, i) => {
        if (message.role !== "user") return message
        const stored = (message.metadata as { canvas?: CanvasNote } | undefined)
            ?.canvas
        const note = stored ?? (i === newest ? requestCanvas : undefined)
        return {
            ...message,
            parts: [
                ...(message.parts ?? []),
                // A new paragraph: some providers join a message's text parts
                { type: "text", text: `\n\n${canvasNoteText(note)}` },
            ],
        }
    })
}
