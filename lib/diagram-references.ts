/**
 * References in a page that point at no cell: a `parent`, `source` or
 * `target` naming an id the page does not have. draw.io drops such a cell or
 * draws no such connector, and a screenshot shows nothing amiss, so writes
 * check for them.
 */

const REFERENCES = ["parent", "source", "target"] as const

/** One problem per dangling reference, as `cell "a": parent "ghost" does not exist` */
export function danglingReferences(modelXml: string | null): string[] {
    if (!modelXml) return []
    const doc = new DOMParser().parseFromString(modelXml, "text/xml")
    if (doc.querySelector("parsererror")) return []
    const cells = Array.from(doc.getElementsByTagName("mxCell"))
    // A cell with links or custom data is wrapped; the wrapper holds the id
    const idOf = (cell: Element) => {
        const wrapper = cell.parentElement
        return wrapper?.tagName === "object" ||
            wrapper?.tagName === "UserObject"
            ? wrapper.getAttribute("id")
            : cell.getAttribute("id")
    }
    const ids = new Set(cells.map(idOf).filter(Boolean))
    const problems: string[] = []
    for (const cell of cells) {
        for (const name of REFERENCES) {
            const ref = cell.getAttribute(name)
            if (ref && !ids.has(ref)) {
                problems.push(
                    `cell "${idOf(cell)}": ${name} "${ref}" does not exist`,
                )
            }
        }
    }
    return problems
}

/** The problems in `after` that `before` did not have: what a change introduced */
export function newDanglingReferences(
    before: string | null,
    after: string | null,
): string[] {
    const old = new Set(danglingReferences(before))
    return danglingReferences(after).filter((p) => !old.has(p))
}
