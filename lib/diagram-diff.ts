/**
 * Which cells changed between two versions of a page, independent of how the
 * XML is written: draw.io saves a cell with its attributes in another order,
 * with default values left out and numbers in their shortest form.
 *
 * Adapted from next-ai-draw-io (lib/diagram-diff.ts, Apache-2.0).
 */
import { plainLabel } from "@/lib/selection"

/** How many shapes and connectors a change added, changed and removed */
export interface ChangeSummary {
    shapesAdded: number
    shapesChanged: number
    shapesRemoved: number
    edgesAdded: number
    edgesChanged: number
    edgesRemoved: number
}

export interface DiagramDiff {
    /** Ids of the cells that were added or changed */
    touchedIds: string[]
    /** The page before had no shapes or connectors */
    fromScratch: boolean
    summary: ChangeSummary
}

// Values draw.io leaves out when it saves: the model may write them
const DEFAULT_VALUES: Record<string, Record<string, string>> = {
    mxCell: {
        vertex: "0",
        edge: "0",
        connectable: "1",
        visible: "1",
        collapsed: "0",
        style: "",
    },
    mxGeometry: { x: "0", y: "0", width: "0", height: "0", relative: "0" },
    mxPoint: { x: "0", y: "0" },
}
// Numbers draw.io writes back in their shortest form ("40.0" is "40")
const NUMBERS = new Set(["x", "y", "width", "height"])
const GEOMETRY = new Set(["mxGeometry", "mxPoint", "mxRectangle"])

/** A style as draw.io reads it: empty entries do nothing */
function normalStyle(style: string): string {
    const entries = style.split(";").filter((entry) => entry.trim() !== "")
    return (style.startsWith(";") ? ";" : "") + entries.join(";")
}

function signatureOf(node: Element): string {
    const defaults = DEFAULT_VALUES[node.tagName] ?? {}
    const attrs = Array.from(node.attributes)
        .flatMap((a) => {
            let value = a.value
            if (a.name === "style" && node.tagName === "mxCell") {
                value = normalStyle(value)
            } else if (
                GEOMETRY.has(node.tagName) &&
                NUMBERS.has(a.name) &&
                value.trim() !== ""
            ) {
                const n = Number(value)
                if (Number.isFinite(n)) value = String(n)
            }
            if (defaults[a.name] === value) return []
            return [[a.name, value]]
        })
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return JSON.stringify([
        node.tagName,
        attrs,
        Array.from(node.children).map(signatureOf),
    ])
}

interface CellEntry {
    cell: Element
    /** The element holding the id: a wrapper for cells with links or data */
    node: Element
}

/** Shapes and connectors of a page model (not the root and its layers) */
function cellEntries(modelXml: string | null): Map<string, CellEntry> {
    const cells = new Map<string, CellEntry>()
    if (!modelXml) return cells
    const doc = new DOMParser().parseFromString(modelXml, "text/xml")
    if (doc.querySelector("parsererror")) return cells
    for (const cell of Array.from(doc.getElementsByTagName("mxCell"))) {
        const wrapper = cell.parentElement
        const wrapped =
            wrapper?.tagName === "object" || wrapper?.tagName === "UserObject"
        const id = cell.getAttribute("id") || wrapper?.getAttribute("id")
        if (!id || id === "0" || cell.getAttribute("parent") === "0") continue
        cells.set(id, { cell, node: wrapped && wrapper ? wrapper : cell })
    }
    return cells
}

function cellsOf(
    modelXml: string | null,
): Map<string, { isEdge: boolean; signature: string }> {
    const cells = new Map<string, { isEdge: boolean; signature: string }>()
    for (const [id, { cell, node }] of cellEntries(modelXml)) {
        cells.set(id, {
            isEdge: cell.getAttribute("edge") === "1",
            signature: signatureOf(node),
        })
    }
    return cells
}

/** What changed from one <mxGraphModel> of a page to the next */
export function diffPageModels(
    beforeModel: string | null,
    afterModel: string | null,
): DiagramDiff {
    const before = cellsOf(beforeModel)
    const after = cellsOf(afterModel)
    const touchedIds: string[] = []
    const summary: ChangeSummary = {
        shapesAdded: 0,
        shapesChanged: 0,
        shapesRemoved: 0,
        edgesAdded: 0,
        edgesChanged: 0,
        edgesRemoved: 0,
    }
    for (const [id, cell] of after) {
        const old = before.get(id)
        if (old?.signature === cell.signature) continue
        touchedIds.push(id)
        if (!old) summary[cell.isEdge ? "edgesAdded" : "shapesAdded"]++
        else summary[cell.isEdge ? "edgesChanged" : "shapesChanged"]++
    }
    for (const [id, cell] of before) {
        if (!after.has(id)) {
            summary[cell.isEdge ? "edgesRemoved" : "shapesRemoved"]++
        }
    }
    return { touchedIds, fromScratch: before.size === 0, summary }
}

/**
 * The labels of the shapes among these cells, in the order of the ids, as
 * HTML-free text. Connectors and their labels are left out, as are shapes
 * without a label.
 */
export function cellLabels(modelXml: string | null, ids: string[]): string[] {
    const cells = cellEntries(modelXml)
    const isEdge = (id: string | null) =>
        !!id && cells.get(id)?.cell.getAttribute("edge") === "1"
    return ids.flatMap((id) => {
        const entry = cells.get(id)
        if (!entry || isEdge(id) || isEdge(entry.cell.getAttribute("parent"))) {
            return []
        }
        // A wrapper keeps the label in its own attribute
        const value =
            entry.node === entry.cell
                ? entry.cell.getAttribute("value")
                : entry.node.getAttribute("label")
        const label = plainLabel(value ?? "")
        return label ? [label] : []
    })
}
