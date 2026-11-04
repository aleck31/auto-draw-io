/**
 * Direct access to the draw.io editor in our same-origin iframe, so an AI
 * change can be shown in place and undone in one step.
 *
 * draw.io has no public JavaScript API for embedders; everything here uses
 * its internal objects (EditorUi, mxGraph), pinned by scripts/drawio-version.json.
 * Every call checks that what it needs exists: when something is missing (a
 * draw.io upgrade, or a cross-origin draw.io) the app falls back to full
 * loads over postMessage.
 *
 * Adapted from next-ai-draw-io (lib/drawio/editor-bridge.ts, Apache-2.0).
 */
import { diffPageModels } from "@/lib/diagram-diff"

type EditorUi = any
type FrameWindow = any

let ui: EditorUi | null = null
let win: FrameWindow | null = null
const warned = new Set<string>()

function warnOnce(key: string, message: string) {
    if (warned.has(key)) return
    warned.add(key)
    console.warn(`[drawio] ${message}`)
}

function graph() {
    return ui?.editor?.graph ?? null
}

/**
 * Finds the EditorUi instance inside a same-origin draw.io iframe. draw.io
 * keeps no global reference to it, so prototype methods it calls on startup
 * and after every load are wrapped; the first call hands us `this`.
 * Returns false when the frame is cross-origin.
 */
export function watchForEditorUi(
    frameWindow: Window,
    onFound: (editorUi: EditorUi) => void,
): boolean {
    let w: any
    try {
        w = frameWindow as any
        // Throws for a cross-origin frame
        void w.document
    } catch {
        return false
    }
    const hook = (proto: any, method: string) => {
        if (!proto || typeof proto[method] !== "function") return
        if (proto[method].__adioWrapped) return
        const original = proto[method]
        const wrapped = function (this: any, ...args: any[]) {
            onFound(this)
            return original.apply(this, args)
        }
        ;(wrapped as any).__adioWrapped = true
        proto[method] = wrapped
    }
    hook(w.EditorUi?.prototype, "updateActionStates")
    hook(w.EditorUi?.prototype, "fileLoaded")
    return true
}

export function attachEditor(editorUi: EditorUi, frameWindow: FrameWindow) {
    if (ui === editorUi) return
    detachEditor()
    ui = editorUi
    win = frameWindow
    // For end-to-end tests (read state through page.frame().evaluate);
    // set on draw.io's own window, which already holds everything
    win.__adioEditorUi = editorUi
    // The app saves every change itself: draw.io's "unsaved changes" prompt
    // on a reload would be wrong
    try {
        ui.onBeforeUnload = () => undefined
    } catch {
        // ignore
    }
    installLockGuards()
}

export function detachEditor() {
    clearHighlights()
    ui = null
    win = null
    previewBase = null
    locked = false
}

export function hasEditor(): boolean {
    return !!ui
}

// ---------------------------------------------------------------------------
// Locking the canvas while an AI tool call streams onto it
// ---------------------------------------------------------------------------

// draw.io re-enables the graph itself (its embed export ends with
// setEnabled(true)), so the lock wraps isEnabled instead of calling
// setEnabled. Page switches and undo/redo don't check isEnabled; they are
// guarded too: a preview always replaces the current page, and undo during a
// preview would replay history against a root the preview replaced.
let locked = false

function installLockGuards() {
    const g = graph()
    if (g && typeof g.isEnabled === "function" && !g.isEnabled.__adioLock) {
        const original = g.isEnabled
        const wrapped = function (this: any, ...args: unknown[]) {
            return !locked && original.apply(this, args)
        }
        ;(wrapped as any).__adioLock = true
        g.isEnabled = wrapped
    } else if (!g) {
        warnOnce(
            "lock",
            "graph not found, the canvas is not locked during AI edits",
        )
    }
    for (const method of ["selectPage", "undo", "redo"]) {
        const original = ui?.[method]
        if (typeof original !== "function" || original.__adioLock) continue
        const wrapped = function (this: any, ...args: unknown[]) {
            if (locked) return undefined
            return original.apply(this, args)
        }
        ;(wrapped as any).__adioLock = true
        ui[method] = wrapped
    }
}

function setLocked(value: boolean) {
    if (locked === value) return
    locked = value
    try {
        // Selection handles and the format panel follow the enabled state
        if (locked) graph()?.clearSelection?.()
        ui?.updateActionStates?.()
    } catch {
        // ignore
    }
}

export function isLocked(): boolean {
    return locked
}

// ---------------------------------------------------------------------------
// Replacing the diagram (AI changes)
// ---------------------------------------------------------------------------

// The document before the current AI change started streaming. Previews are
// applied without undo history; the final result replaces this base as one
// undo step.
let previewBase: string | null = null

function currentFileXml(): string | null {
    try {
        const node = ui.getXmlFileData(null, null, true)
        return win.mxUtils.getXml(node)
    } catch {
        return null
    }
}

function withoutUndo(fn: () => void) {
    const manager = ui?.editor?.undoManager
    if (!manager?.undoableEditHappened) {
        fn()
        return
    }
    const original = manager.undoableEditHappened
    manager.undoableEditHappened = () => {}
    try {
        fn()
    } finally {
        manager.undoableEditHappened = original
    }
}

/** Id of the page on the canvas */
export function currentPageId(): string | null {
    const id = ui?.currentPage?.getId?.()
    return id === undefined || id === null ? null : String(id)
}

/** Show the page with this id; false when draw.io has no such page */
export function selectPage(pageId: string): boolean {
    try {
        const page = ui?.getPageById?.(pageId)
        if (!page || typeof ui.selectPage !== "function") return false
        if (ui.currentPage !== page && !locked) ui.selectPage(page, true)
        return ui.currentPage === page
    } catch {
        return false
    }
}

function parse(xml: string): Document | null {
    const doc = new DOMParser().parseFromString(xml, "text/xml")
    return doc.querySelector("parsererror") ? null : doc
}

/** A page's <mxGraphModel> as XML, inflated when the page is compressed */
function modelXmlOf(diagram: Element): string | null {
    const model = diagram.getElementsByTagName("mxGraphModel")[0]
    if (model) return new XMLSerializer().serializeToString(model)
    try {
        const text = diagram.textContent?.trim()
        const inflated = text ? win?.Graph?.decompress?.(text) : null
        return typeof inflated === "string" &&
            inflated.includes("<mxGraphModel")
            ? inflated
            : null
    } catch {
        return null
    }
}

/**
 * The <mxGraphModel> replaceDiagramData puts on the current page: the
 * document's page with the canvas page's id, or its only page
 */
function pageModelOf(xml: string): string | null {
    const doc = parse(xml)
    if (!doc) return null
    const root = doc.documentElement
    if (root.nodeName === "mxGraphModel") return xml
    if (root.nodeName !== "mxfile") return null
    const diagrams = Array.from(root.getElementsByTagName("diagram"))
    const id = currentPageId()
    const diagram =
        diagrams.length === 1
            ? diagrams[0]
            : diagrams.find((d) => d.getAttribute("id") === id)
    return diagram ? modelXmlOf(diagram) : null
}

/** The other pages (all but the current one), each as its model XML */
function otherPageModels(xml: string | null): Map<string, string> | null {
    if (!xml) return null
    const doc = parse(xml)
    if (!doc) return null
    const root = doc.documentElement
    if (root.nodeName === "mxGraphModel") return new Map()
    if (root.nodeName !== "mxfile") return null
    const id = currentPageId()
    const result = new Map<string, string>()
    const diagrams = Array.from(root.getElementsByTagName("diagram"))
    if (diagrams.length <= 1) return result
    for (const diagram of diagrams) {
        const pageId = diagram.getAttribute("id") || ""
        if (pageId === id) continue
        const model = modelXmlOf(diagram)
        if (model === null) return null
        result.set(`${pageId}\n${diagram.getAttribute("name") || ""}`, model)
    }
    return result
}

/** Whitespace-insensitive comparison of two models */
function sameModel(a: string, b: string): boolean {
    const norm = (xml: string) => {
        const doc = parse(xml)
        return doc ? new XMLSerializer().serializeToString(doc) : xml
    }
    return norm(a).replace(/>\s+</g, "><") === norm(b).replace(/>\s+</g, "><")
}

/**
 * The document changes the current page only: its other pages are the
 * canvas's. draw.io may write a page's model with defaults filled in, so a
 * page counts as the same when its cells are; anything else loads in full.
 */
function otherPagesSame(xml: string): boolean {
    const theirs = otherPageModels(xml)
    if (theirs === null) return false
    const pageCount = Array.isArray(ui.pages) ? ui.pages.length : 1
    if (pageCount <= 1 && theirs.size === 0) return true
    const ours = otherPageModels(currentFileXml())
    if (ours === null || ours.size !== theirs.size) return false
    for (const [key, model] of theirs) {
        const other = ours.get(key)
        if (other === undefined) return false
        if (!sameModel(cellsOf(model), cellsOf(other))) return false
    }
    return true
}

function cellsOf(model: string): string {
    const doc = parse(model)
    const root = doc?.getElementsByTagName("root")[0]
    return root ? new XMLSerializer().serializeToString(root) : model
}

/**
 * Page settings draw.io applies on a full load only: replacing the page in
 * place keeps the old ones
 */
function hasLoadOnlySettings(model: Element): boolean {
    return (
        model.hasAttribute("backgroundImage") ||
        model.hasAttribute("extFonts") ||
        model.getAttribute("math") === "1" ||
        model.getAttribute("shadow") === "1"
    )
}

function canvasHasLoadOnlySettings(): boolean {
    const g = graph()
    return (
        !!g &&
        (!!g.backgroundImage ||
            !!g.mathEnabled ||
            !!g.shadowVisible ||
            (g.extFonts?.length ?? 0) > 0)
    )
}

function fileVars(xml: string): string | null {
    const root = parse(xml)?.documentElement
    return root?.nodeName === "mxfile" ? root.getAttribute("vars") : null
}

/** Can this document go through the editor (in place, with undo) instead of a full load? */
export function canReplaceDiagram(xml: string): boolean {
    if (!ui) return false
    if (typeof ui.replaceDiagramData !== "function") {
        warnOnce("replace", "replaceDiagramData not found, using full loads")
        return false
    }
    if (!otherPagesSame(xml)) return false
    if (
        (fileVars(xml) || null) !==
        (ui.fileNode?.getAttribute?.("vars") || null)
    ) {
        return false
    }
    const model = pageModelOf(xml)
    if (model === null) return false
    const modelEl = parse(model)?.documentElement
    return (
        !!modelEl &&
        !hasLoadOnlySettings(modelEl) &&
        !canvasHasLoadOnlySettings()
    )
}

function replace(xml: string) {
    const model = pageModelOf(xml)
    if (!model || typeof ui?.replaceDiagramData !== "function") {
        throw new Error("Diagram can't be replaced in place")
    }
    keepView(() => ui.replaceDiagramData(model))
}

/**
 * Runs fn and puts back the zoom and scroll position: setGraphXml reads the
 * view state from the model, which an AI page doesn't carry
 */
function keepView(fn: () => void) {
    const g = graph()
    const view = g?.view
    const container = g?.container as HTMLElement | undefined
    if (!view || !container) {
        fn()
        return
    }
    const scale = view.scale
    const tx = view.translate.x
    const ty = view.translate.y
    const left = container.scrollLeft
    const top = container.scrollTop
    fn()
    try {
        if (
            view.scale !== scale ||
            view.translate.x !== tx ||
            view.translate.y !== ty
        ) {
            view.scaleAndTranslate(scale, tx, ty)
        }
        container.scrollLeft = left
        container.scrollTop = top
    } catch {
        // ignore
    }
}

function isEmptyModel(): boolean {
    const g = graph()
    const root = g?.model.getRoot()
    if (!root) return true
    for (let i = 0; i < g.model.getChildCount(root); i++) {
        if (g.model.getChildCount(g.model.getChildAt(root, i)) > 0) return false
    }
    return true
}

/** Show a streaming preview without touching the undo history; locks the canvas */
export function previewDiagram(xml: string) {
    clearHighlights()
    if (previewBase === null) previewBase = currentFileXml() ?? ""
    setLocked(true)
    const wasEmpty = isEmptyModel()
    withoutUndo(() => replace(xml))
    if (wasEmpty) fitDiagram()
}

/**
 * Apply the final AI result as a single undo step whose undo goes back to
 * the document before streaming started. Unlocks the canvas.
 */
export function commitDiagram(xml: string) {
    const wasEmpty = isEmptyModel()
    const base = previewBase ? pageModelOf(previewBase) : null
    // The page before this change, for marking what it touched
    const before = base ?? pageModelOf(currentFileXml() ?? "")
    previewBase = null
    setLocked(false)
    // draw.io's ReplaceDiagram change keeps the document it replaced for
    // undo: hand it the pre-stream page so the canvas changes once
    const ReplaceDiagram = win?.ReplaceDiagram
    const direct = typeof ReplaceDiagram === "function" && !!win?.mxUtils
    if (base && !direct) withoutUndo(() => replace(base))
    const model = graph()?.model
    model?.beginUpdate()
    try {
        const next = pageModelOf(xml)
        if (direct && next) {
            const change = new ReplaceDiagram(
                ui,
                win.mxUtils.parseXml(next).documentElement,
            )
            keepView(() => model.execute(change))
            if (base) change.data = win.mxUtils.parseXml(base).documentElement
        } else {
            replace(xml)
        }
    } finally {
        model?.endUpdate()
    }
    if (wasEmpty) fitDiagram()
    const { touchedIds, fromScratch } = diffPageModels(before, pageModelOf(xml))
    // A whole new diagram needs no marking
    if (!fromScratch) highlightCellsSoon(touchedIds)
}

/** Commit what the canvas shows now (a stopped stream), as one undo step */
export function commitShownPreview(): string | null {
    if (previewBase === null) {
        setLocked(false)
        return null
    }
    const shown = currentFileXml()
    if (shown) commitDiagram(shown)
    else setLocked(false)
    return shown
}

/** Throw away the preview and go back to the document before it; returns that document */
export function revertPreview(): string | null {
    const base = previewBase
    previewBase = null
    setLocked(false)
    if (base) withoutUndo(() => replace(base))
    return base
}

/** Forget the preview base (a full load replaced the canvas) */
export function resetPreview() {
    previewBase = null
    setLocked(false)
}

export function hasPreview(): boolean {
    return previewBase !== null
}

// Room around a fitted diagram (half of this on each side)
const FIT_BORDER = 128

/** Fit the shapes into the canvas, at most at 100% */
function fitDiagram() {
    const g = graph()
    if (!g) return
    try {
        const b = g.getGraphBounds()
        const { scale, translate } = g.view
        if (b && b.width > 0 && b.height > 0 && win?.mxRectangle) {
            g.fitWindow(
                new win.mxRectangle(
                    b.x / scale - translate.x,
                    b.y / scale - translate.y,
                    b.width / scale,
                    b.height / scale,
                ),
                FIT_BORDER,
                1,
            )
        }
    } catch {
        // ignore
    }
}

/** Internals the bridge needs; for diagnostics and upgrade checks */
export function missingInternals(): string[] {
    const checks: Record<string, unknown> = {
        "EditorUi.replaceDiagramData": ui?.replaceDiagramData,
        "EditorUi.getXmlFileData": ui?.getXmlFileData,
        "EditorUi.getPageById": ui?.getPageById,
        "EditorUi.selectPage": ui?.selectPage,
        "EditorUi.undo": ui?.undo,
        "EditorUi.redo": ui?.redo,
        ReplaceDiagram: win?.ReplaceDiagram,
        "mxUtils.parseXml": win?.mxUtils?.parseXml,
        "mxUtils.getXml": win?.mxUtils?.getXml,
        "Graph.decompress": win?.Graph?.decompress,
        "undoManager.undoableEditHappened":
            ui?.editor?.undoManager?.undoableEditHappened,
        "graph.isEnabled": graph()?.isEnabled,
    }
    return Object.entries(checks)
        .filter(([, value]) => typeof value !== "function")
        .map(([name]) => name)
}

// ---------------------------------------------------------------------------
// Marking the cells an AI change touched
// ---------------------------------------------------------------------------

// The outline stays this long, then fades out
const HIGHLIGHT_MS = 3000
const FADE_MS = 400
// Soft halo for shapes, and an outline dark enough for white paper and pale fills
const HALO_COLOR = "#ffd84d"
const OUTLINE_COLOR = "#a86b00"

let highlights: any[] = []
let highlightTimer: ReturnType<typeof setTimeout> | null = null

/** Removes the marking of the last change (also one still to come) */
export function clearHighlights() {
    if (highlightTimer) clearTimeout(highlightTimer)
    highlightTimer = null
    for (const h of highlights) {
        try {
            h.destroy()
        } catch {
            // ignore
        }
    }
    highlights = []
}

/**
 * Marks cells for a few seconds, once draw.io has drawn them: shapes get a
 * halo and an outline, connectors the outline only (a halo would cover their
 * labels and arrows). Drawn over the canvas, never part of the diagram.
 */
function highlightCellsSoon(ids: string[]) {
    clearHighlights()
    if (ids.length === 0) return
    highlightTimer = setTimeout(() => {
        highlightTimer = null
        const g = graph()
        if (!g || typeof win?.mxCellHighlight !== "function") return
        const add = (
            state: any,
            color: string,
            width: number,
            opacity: number,
        ) => {
            const h = new win.mxCellHighlight(g, color, width)
            h.opacity = opacity
            h.highlight(state)
            highlights.push(h)
        }
        for (const id of ids.slice(0, 200)) {
            const cell = g.model.getCell(id)
            const state = cell ? g.view.getState(cell) : null
            if (!state) continue
            if (!g.model.isEdge(cell)) add(state, HALO_COLOR, 8, 35)
            add(state, OUTLINE_COLOR, 2, 100)
        }
        if (highlights.length === 0) return
        highlightTimer = setTimeout(() => {
            for (const h of highlights) {
                const node = h.shape?.node as SVGElement | undefined
                if (!node) continue
                node.style.transition = `opacity ${FADE_MS}ms`
                node.style.opacity = "0"
            }
            highlightTimer = setTimeout(clearHighlights, FADE_MS)
        }, HIGHLIGHT_MS)
    }, 60)
}
