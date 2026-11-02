/**
 * A fingerprint of a page's diagram that ignores how the XML is written.
 *
 * The XML the model wrote and the XML draw.io exports for the same diagram
 * differ in attribute order, default attributes, compression and the order
 * of cells (draw.io writes each parent followed by its children), so text
 * comparison would report a change after every AI edit. This compares what
 * the model sees: each cell's id, parent, kind, value, style, ends and
 * geometry, in draw.io's tree order. Browser only (DOMParser).
 */
import { aiPageModel } from "@/lib/ai-page"

const num = (value: string | null) => {
    const n = Number(value ?? 0)
    return Number.isFinite(n) ? String(Math.round(n * 100) / 100) : "0"
}

/** Style tokens without the ones draw.io adds by itself, in a fixed order */
function normalizeStyle(style: string | null): string {
    return (style ?? "")
        .split(";")
        .map((token) => token.trim())
        .filter(
            (token) =>
                token && token !== "html=1" && token !== "whiteSpace=wrap",
        )
        .sort()
        .join(";")
}

function cellKey(cell: Element): string {
    const geometry = Array.from(cell.children).find(
        (child) => child.nodeName === "mxGeometry",
    )
    const points = geometry
        ? Array.from(geometry.getElementsByTagName("mxPoint"))
              .filter((p) => p.parentElement?.nodeName === "Array")
              .map(
                  (p) =>
                      `${num(p.getAttribute("x"))},${num(p.getAttribute("y"))}`,
              )
              .join(" ")
        : ""
    const geo = geometry
        ? geometry.getAttribute("relative") === "1"
            ? `rel ${num(geometry.getAttribute("x"))},${num(geometry.getAttribute("y"))}`
            : ["x", "y", "width", "height"]
                  .map((name) => num(geometry.getAttribute(name)))
                  .join(",")
        : ""
    // A cell wrapped in <object>/<UserObject> takes its label from the wrapper
    const wrapper = cell.parentElement
    const wrapped =
        wrapper?.nodeName === "object" || wrapper?.nodeName === "UserObject"
    const value = wrapped
        ? (wrapper?.getAttribute("label") ?? "")
        : (cell.getAttribute("value") ?? "")
    return [
        wrapped ? wrapper?.getAttribute("id") : cell.getAttribute("id"),
        cell.getAttribute("vertex") === "1"
            ? "v"
            : cell.getAttribute("edge") === "1"
              ? "e"
              : "",
        value,
        normalizeStyle(cell.getAttribute("style")),
        cell.getAttribute("source") ?? "",
        cell.getAttribute("target") ?? "",
        geo,
        points,
    ].join("|")
}

/** Fingerprint of the AI's page of a document (or of a bare mxGraphModel) */
export function canvasFingerprint(xml: string): string | null {
    const model = aiPageModel(xml)
    if (!model) return null
    const doc = new DOMParser().parseFromString(model, "text/xml")
    if (doc.querySelector("parsererror")) return null
    const cells = Array.from(doc.getElementsByTagName("mxCell"))
    const idOf = (cell: Element) => {
        const wrapper = cell.parentElement
        return wrapper?.nodeName === "object" ||
            wrapper?.nodeName === "UserObject"
            ? (wrapper.getAttribute("id") ?? "")
            : (cell.getAttribute("id") ?? "")
    }
    // Children in document order under each parent, walked from the root
    const children = new Map<string, Element[]>()
    for (const cell of cells) {
        const parent = cell.getAttribute("parent") ?? ""
        children.set(parent, [...(children.get(parent) ?? []), cell])
    }
    const ordered: string[] = []
    const seen = new Set<string>()
    const walk = (parent: string) => {
        for (const cell of children.get(parent) ?? []) {
            const id = idOf(cell)
            if (seen.has(id)) continue
            seen.add(id)
            ordered.push(
                `${cell.getAttribute("parent") ?? ""}>${cellKey(cell)}`,
            )
            walk(id)
        }
    }
    walk("")
    // Cells whose parent is missing, so the walk didn't reach them
    for (const cell of cells) {
        if (!seen.has(idOf(cell))) ordered.push(`?>${cellKey(cell)}`)
    }
    return ordered.join("\n")
}
