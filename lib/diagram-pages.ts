/**
 * Multi-page document helpers. The AI reads and writes one page of the
 * canvas file (the first page for now); these functions pull that page out
 * and put a drawing back into it while the other pages stay as they are.
 *
 * Adapted from next-ai-draw-io (lib/diagram-pages.ts, Apache-2.0).
 * They use DOMParser; server code gets it from lib/server-dom.
 */
import { inflateRaw } from "pako"

const ROOT_CELLS = '<mxCell id="0"/><mxCell id="1" parent="0"/>'

export const BLANK_MXFILE = `<mxfile><diagram name="Page-1" id="page-1"><mxGraphModel><root>${ROOT_CELLS}</root></mxGraphModel></diagram></mxfile>`

/** The parsed XML, or null when it is empty or does not parse */
export function parseXml(xml: string): Document | null {
    if (!xml?.trim()) return null
    const doc = new DOMParser().parseFromString(xml, "text/xml")
    return doc.querySelector("parsererror") ? null : doc
}

/** A compressed page's content (base64 deflate, usually URI-encoded) */
function decompressPageContent(compressed: string): string | null {
    try {
        const bytes = Uint8Array.from(atob(compressed.trim()), (c) =>
            c.charCodeAt(0),
        )
        const inflated = inflateRaw(bytes, { to: "string" })
        try {
            return decodeURIComponent(inflated)
        } catch {
            return inflated
        }
    } catch {
        return null
    }
}

function fileVars(doc: Document): string | null {
    return doc.documentElement.nodeName === "mxfile"
        ? doc.documentElement.getAttribute("vars")
        : null
}

function diagramsOf(doc: Document): Element[] {
    return Array.from(doc.getElementsByTagName("diagram"))
}

/** The <diagram> with this id, else the first */
function pageElement(
    doc: Document,
    pageId: string | null | undefined,
): Element | null {
    const diagrams = diagramsOf(doc)
    if (diagrams.length === 0) return null
    return (
        (pageId && diagrams.find((d) => d.getAttribute("id") === pageId)) ||
        diagrams[0]
    )
}

/** A page's mxGraphModel element, inflated when the page is compressed */
function modelOfPage(diagram: Element): Element | null {
    const model = diagram.getElementsByTagName("mxGraphModel")[0]
    if (model) return model
    const inflated = decompressPageContent(diagram.textContent || "")
    if (!inflated) return null
    return parseXml(inflated)?.getElementsByTagName("mxGraphModel")[0] ?? null
}

/**
 * Every compressed page inflated into a plain <mxGraphModel>, so code that
 * looks for "mxGraphModel > root" finds the right page. draw.io's export
 * message compresses pages; its autosave message does not.
 */
export function uncompressPages(xml: string): string {
    const doc = parseXml(xml)
    if (doc?.documentElement.nodeName !== "mxfile") return xml
    let changed = false
    for (const diagram of diagramsOf(doc)) {
        if (diagram.getElementsByTagName("mxGraphModel")[0]) continue
        const model = modelOfPage(diagram)
        if (!model) continue
        while (diagram.firstChild) diagram.removeChild(diagram.firstChild)
        diagram.appendChild(doc.importNode(model, true))
        changed = true
    }
    return changed ? new XMLSerializer().serializeToString(doc) : xml
}

/** Name and id of every page, in order; empty when the XML is not a file */
export function listPages(xml: string): { id: string; name: string }[] {
    const doc = parseXml(xml)
    if (doc?.documentElement.nodeName !== "mxfile") return []
    return diagramsOf(doc).map((d, i) => ({
        id: d.getAttribute("id") || "",
        name: d.getAttribute("name") || `Page-${i + 1}`,
    }))
}

/**
 * The page's mxGraphModel as XML. A bare mxGraphModel is returned as it is;
 * null when the XML does not parse or has no model.
 */
export function pageModelXml(
    xml: string,
    pageId: string | null | undefined,
): string | null {
    const doc = parseXml(xml)
    if (!doc) return null
    const root = doc.documentElement
    if (root.nodeName === "mxGraphModel") return xml
    if (root.nodeName !== "mxfile") return null
    const diagram = pageElement(doc, pageId)
    const model = diagram ? modelOfPage(diagram) : null
    return model ? new XMLSerializer().serializeToString(model) : null
}

/**
 * The document with one page's content replaced by this model. The page
 * keeps its id and name; the other pages and the file's attributes stay.
 * Without a document to put the page in, the blank one-page file is used.
 */
function replacePageModel(
    fileXml: string,
    pageId: string | null | undefined,
    modelXml: string,
): string {
    const model = parseXml(modelXml)
    if (model?.documentElement.nodeName !== "mxGraphModel") {
        throw new Error("replacePageModel needs an <mxGraphModel>")
    }
    let doc = parseXml(fileXml)
    if (doc?.documentElement.nodeName !== "mxfile") doc = parseXml(BLANK_MXFILE)
    let diagram = pageElement(doc as Document, pageId)
    if (!diagram) {
        doc = parseXml(BLANK_MXFILE)
        diagram = pageElement(doc as Document, null)
    }
    const target = diagram as Element
    while (target.firstChild) target.removeChild(target.firstChild)
    target.appendChild(
        (doc as Document).importNode(model.documentElement, true),
    )
    return new XMLSerializer().serializeToString(doc as Document)
}

/**
 * Where a drawn diagram goes. One page's worth replaces the AI's page of the
 * canvas file. A file with several pages replaces the whole document: it was
 * written that way on purpose. File variables the drawn file sets replace
 * the canvas file's; a drawn file without any keeps the canvas file's.
 */
export function placeOnPage(
    drawnXml: string,
    canvasXml: string,
    pageId: string | null | undefined,
): string {
    const doc = parseXml(drawnXml)
    const drawnFile =
        doc?.documentElement.nodeName === "mxfile" ? doc.documentElement : null
    const severalPages =
        (drawnFile?.getElementsByTagName("diagram").length ?? 0) > 1
    const model = severalPages ? null : pageModelXml(drawnXml, null)
    if (!model) {
        const canvas = parseXml(canvasXml)
        const canvasVars = canvas ? fileVars(canvas) : null
        if (!doc || !drawnFile || fileVars(doc) !== null || !canvasVars) {
            return drawnXml
        }
        drawnFile.setAttribute("vars", canvasVars)
        return new XMLSerializer().serializeToString(doc)
    }
    const placed = replacePageModel(canvasXml, pageId, model)
    const vars = drawnFile?.getAttribute("vars")
    if (vars === null || vars === undefined) return placed
    const result = parseXml(placed) as Document
    result.documentElement.setAttribute("vars", vars)
    return new XMLSerializer().serializeToString(result)
}

type Validation = {
    valid: boolean
    error: string | null
    fixed: string | null
    fixes: string[]
}

/**
 * Validates every page on its own. Ids only have to be unique within a page
 * (each page has its own "0" and "1" root cells), so validating a multi-page
 * file as one diagram would report, and "fix", ids the other pages share.
 * Fixed pages are written back uncompressed; untouched pages stay as they are.
 */
export function validateEachPage(
    xml: string,
    validate: (xml: string) => Validation,
): Validation {
    const doc = parseXml(xml)
    const diagrams =
        doc?.documentElement.nodeName === "mxfile" ? diagramsOf(doc) : []
    if (!doc || diagrams.length < 2) return validate(xml)

    const fixes: string[] = []
    let changed = false
    for (const [i, diagram] of diagrams.entries()) {
        const model = modelOfPage(diagram)
        if (!model) continue
        const result = validate(new XMLSerializer().serializeToString(model))
        const name = diagram.getAttribute("name") || `Page-${i + 1}`
        if (!result.valid) {
            return { ...result, error: `Page "${name}": ${result.error}` }
        }
        if (!result.fixed) continue
        const fixedModel = parseXml(result.fixed)?.getElementsByTagName(
            "mxGraphModel",
        )[0]
        if (!fixedModel) continue
        while (diagram.firstChild) diagram.removeChild(diagram.firstChild)
        diagram.appendChild(doc.importNode(fixedModel, true))
        fixes.push(...result.fixes.map((fix) => `${name}: ${fix}`))
        changed = true
    }
    return {
        valid: true,
        error: null,
        fixed: changed ? new XMLSerializer().serializeToString(doc) : null,
        fixes,
    }
}
