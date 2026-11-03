/**
 * Whether two documents are the same diagram, however they are written.
 *
 * draw.io rewrites a document when it saves it: attribute order, pretty-
 * printing, omitted zero coordinates, regenerated page ids, view attributes on
 * <mxGraphModel> (dx, dy, pageWidth...), compressed pages, and cells reordered
 * so each parent is followed by its children. None of that is an edit. The
 * fingerprint keeps what a user can change: the pages, their names and each
 * page's cell tree (tags, sorted attributes, text).
 *
 * Adapted from next-ai-draw-io (packages/mcp-server/src/edit-gate.ts,
 * contentFingerprint, Apache-2.0). Uses DOMParser: server code imports
 * lib/server-dom first.
 */
import { parseXml, uncompressPages } from "@/lib/diagram-pages"

// draw.io leaves out a point's or geometry's coordinates and sizes that are
// 0 when it writes a diagram, so x="0" and no x are the same diagram
const ZERO_DEFAULT_TAGS = new Set(["mxPoint", "mxGeometry", "mxRectangle"])
const ZERO_DEFAULT_ATTRS = new Set(["x", "y", "width", "height"])

const isLeftOutZero = (el: Element, attr: Attr) =>
    ZERO_DEFAULT_TAGS.has(el.tagName) &&
    ZERO_DEFAULT_ATTRS.has(attr.name) &&
    attr.value.trim() !== "" &&
    Number(attr.value) === 0

/** A page's cells in draw.io's order: each cell followed by its children */
function cellsInDrawioOrder(root: Element): Element[] {
    const cells = Array.from(root.children)
    const idOf = (cell: Element) => cell.getAttribute("id") ?? ""
    // <object> and <UserObject> keep the parent on their inner mxCell
    const parentOf = (cell: Element) =>
        (cell.tagName === "mxCell"
            ? cell
            : Array.from(cell.children).find((c) => c.tagName === "mxCell")
        )?.getAttribute("parent") ?? ""
    const ids = new Set(cells.map(idOf).filter(Boolean))
    const children = new Map<string, Element[]>()
    const tops: Element[] = []
    for (const cell of cells) {
        const parent = parentOf(cell)
        if (parent && parent !== idOf(cell) && ids.has(parent)) {
            children.set(parent, [...(children.get(parent) ?? []), cell])
        } else {
            tops.push(cell)
        }
    }
    const ordered: Element[] = []
    const seen = new Set<Element>()
    const visit = (cell: Element) => {
        if (seen.has(cell)) return
        seen.add(cell)
        ordered.push(cell)
        for (const child of children.get(idOf(cell)) ?? []) visit(child)
    }
    for (const cell of tops) visit(cell)
    // Cells in a parent cycle never hang below a top cell
    for (const cell of cells) visit(cell)
    return ordered
}

/** Tag, sorted attributes, child elements in order and non-blank text */
function canonicalize(el: Element): string {
    const attrs = Array.from(el.attributes)
        .filter((a) => !isLeftOutZero(el, a))
        .map((a) => `${a.name}=${JSON.stringify(a.value)}`)
        .sort()
        .join(" ")
    const nodes =
        el.tagName === "root"
            ? cellsInDrawioOrder(el)
            : Array.from(el.childNodes)
    let children = ""
    for (const child of nodes) {
        if (child.nodeType === 1) {
            children += canonicalize(child as Element)
        } else if (child.nodeType === 3 || child.nodeType === 4) {
            const text = (child.textContent ?? "").trim()
            if (text) children += JSON.stringify(text)
        }
    }
    return `<${el.tagName} ${attrs}>${children}</${el.tagName}>`
}

/** The fingerprint of a document, or of a bare <mxGraphModel> (one unnamed page) */
export function diagramFingerprint(xml: string): string {
    const doc = parseXml(uncompressPages(xml))
    if (!doc) return xml.trim()
    const root = doc.documentElement
    if (root.nodeName === "mxGraphModel") {
        const cells = root.getElementsByTagName("root")[0]
        return `=${cells ? canonicalize(cells) : ""}`
    }
    if (root.nodeName !== "mxfile") return xml.trim()
    // File variables are the one <mxfile> attribute a user edits
    const vars = `vars=${root.getAttribute("vars") ?? ""}\n`
    return (
        vars +
        Array.from(root.getElementsByTagName("diagram"))
            .map((page) => {
                const cells = page.getElementsByTagName("root")[0]
                const body = cells
                    ? canonicalize(cells)
                    : (page.textContent ?? "").trim()
                return `${page.getAttribute("name") ?? ""}=${body}`
            })
            .join("\n")
    )
}

export function sameDiagram(a: string, b: string): boolean {
    return a === b || diagramFingerprint(a) === diagramFingerprint(b)
}
