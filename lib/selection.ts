/**
 * Shapes the user selected on the canvas. They go with a chat message, in
 * its metadata, and the server tells the model to apply the request to them.
 *
 * Adapted from next-ai-draw-io (lib/chat-helpers.ts, Apache-2.0).
 */

export interface SelectedCell {
    id: string
    /** Plain text, cut to MAX_LABEL characters */
    label: string
    isEdge: boolean
}

const MAX_LABEL = 80
// The prompt lists this many; past it, the model is told how many more
const MAX_LISTED = 50

/** A label as plain text: labels can hold HTML */
export function plainLabel(text: string): string {
    const plain = text
        .replace(/<br\s*\/?>/gi, " ")
        .replace(/<[^>]+>/g, "")
        .replace(/&nbsp;/g, " ")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, "&")
        .replace(/\s+/g, " ")
        .trim()
    return plain.length > MAX_LABEL ? `${plain.slice(0, MAX_LABEL)}…` : plain
}

/** Same ids, same key: a label edit keeps a selection the user took off the message */
export function selectionKey(cells: SelectedCell[]): string {
    return cells.map((c) => c.id).join(",")
}

/** The selection a message carries, from its metadata */
export function selectionOf(metadata: unknown): SelectedCell[] {
    const cells = (metadata as { selectedCells?: unknown } | undefined)
        ?.selectedCells
    return Array.isArray(cells) ? cells : []
}

// Metadata comes from the browser: one line each, quotes out, bounded
function clean(value: unknown, max: number): string {
    if (typeof value !== "string") return ""
    return value
        .replace(/[\r\n"]+/g, " ")
        .trim()
        .slice(0, max)
}

/** What the model is told about a message's selection; "" without one */
export function selectionNoteText(cells: unknown): string {
    if (!Array.isArray(cells)) return ""
    const lines = cells
        .slice(0, MAX_LISTED)
        .map((cell) => {
            const id = clean(cell?.id, 100)
            if (!id) return null
            const kind = cell?.isEdge ? "connector" : "shape"
            const label = clean(cell?.label, MAX_LABEL + 1)
            return `- id="${id}" (${kind}${label ? `: ${label}` : ""})`
        })
        .filter((line): line is string => line !== null)
    if (lines.length === 0) return ""
    const more = cells.length - MAX_LISTED
    if (more > 0) lines.push(`- and ${more} more not listed`)
    return `[Selection: the user selected these cells on the canvas before sending this message:\n${lines.join("\n")}\nApply the request to them unless it clearly asks for something else, and change them with edit_diagram by these ids rather than redrawing the diagram.]`
}
