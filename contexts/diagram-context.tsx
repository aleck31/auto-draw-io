"use client"

import type React from "react"
import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useRef,
    useState,
} from "react"
import { STORAGE_DIAGRAM_XML_KEY } from "@/components/chat-panel"
import type { DrawioFrameHandle } from "@/components/drawio-frame"
import type { ExportFormat } from "@/components/save-dialog"
import { getApiEndpoint } from "@/lib/base-path"
import { uncompressPages, validateEachPage } from "@/lib/diagram-pages"
import {
    canReplaceDiagram,
    commitDiagram,
    commitShownPreview,
    currentPageId,
    hasPreview,
    previewDiagram,
    resetPreview,
    revertPreview,
    selectPage,
} from "@/lib/drawio-bridge"
import {
    extractDiagramXML,
    isRealDiagram,
    validateAndFixXml,
} from "../lib/utils"

/**
 * How a diagram reaches the canvas:
 * - "open": a full load (links, restores, new chat); no undo history.
 * - "preview": an AI result still streaming; shown in place, not in the undo
 *   history, canvas locked. Ignored outside an AI turn and after its tool
 *   call was committed.
 * - "commit": a final result; one undo step back to the canvas before the
 *   previews. Once per toolCallId.
 * Without a same-origin editor every mode is a full load.
 */
export type LoadMode = "open" | "preview" | "commit"

export interface LoadOptions {
    mode?: LoadMode
    toolCallId?: string
}

interface DiagramContextType {
    chartXML: string
    latestSvg: string
    diagramHistory: { svg: string; xml: string }[]
    loadDiagram: (
        chart: string,
        skipValidation?: boolean,
        options?: LoadOptions,
    ) => string | null
    /** Put the canvas back as it was before the current previews; that tool call's late previews are ignored */
    revertAiPreview: (toolCallId?: string) => void
    /** An AI turn started (true) or ended (false); ending commits a leftover preview */
    setAiTurnActive: (active: boolean) => void
    handleExport: () => void
    handleExportWithoutHistory: () => void
    resolverRef: React.Ref<((value: string) => void) | null>
    drawioRef: React.Ref<DrawioFrameHandle | null>
    handleDiagramExport: (data: any) => void
    handleDiagramAutoSave: (data: { xml?: string }) => void
    clearDiagram: () => void
    saveDiagramToFile: (
        filename: string,
        format: ExportFormat,
        sessionId?: string,
    ) => void
    saveDiagramToStorage: () => Promise<void>
    capturePng: () => Promise<string>
    isDrawioReady: boolean
    onDrawioLoad: () => void
    resetDrawioReady: () => void
    showSaveDialog: boolean
    setShowSaveDialog: (show: boolean) => void
}

const DiagramContext = createContext<DiagramContextType | undefined>(undefined)

export function DiagramProvider({ children }: { children: React.ReactNode }) {
    const [chartXML, setChartXML] = useState<string>("")
    const [latestSvg, setLatestSvg] = useState<string>("")
    const [diagramHistory, setDiagramHistory] = useState<
        { svg: string; xml: string }[]
    >([])
    const [isDrawioReady, setIsDrawioReady] = useState(false)
    const [canSaveDiagram, setCanSaveDiagram] = useState(false)
    const [showSaveDialog, setShowSaveDialog] = useState(false)
    const hasCalledOnLoadRef = useRef(false)
    const drawioRef = useRef<DrawioFrameHandle | null>(null)
    const resolverRef = useRef<((value: string) => void) | null>(null)
    // Track if we're expecting an export for history (user-initiated)
    const expectHistoryExportRef = useRef<boolean>(false)
    // Track if diagram has been restored from localStorage
    const hasDiagramRestoredRef = useRef<boolean>(false)

    // Full loads go through postMessage and land later; in-place changes are
    // immediate, so they wait until no full load is pending (else the load
    // would overwrite them)
    const pendingLoadsRef = useRef(0)
    // toolCallIds that are finished: committed, or failed and reverted
    const committedToolCallsRef = useRef<Set<string>>(new Set())
    const aiTurnActiveRef = useRef(false)
    // Page to show again once a pending full load lands
    const reselectPageRef = useRef<string | null>(null)

    const onDrawioLoad = () => {
        pendingLoadsRef.current = Math.max(0, pendingLoadsRef.current - 1)
        const pageId = reselectPageRef.current
        if (pageId && pendingLoadsRef.current === 0) {
            reselectPageRef.current = null
            selectPage(pageId)
        }
        // Only set ready state once to prevent infinite loops
        if (hasCalledOnLoadRef.current) return
        hasCalledOnLoadRef.current = true
        console.log("[DiagramContext] DrawIO loaded, setting ready state")
        setIsDrawioReady(true)
    }

    const resetDrawioReady = () => {
        console.log("[DiagramContext] Resetting DrawIO ready state")
        hasCalledOnLoadRef.current = false
        pendingLoadsRef.current = 0
        resetPreview()
        setIsDrawioReady(false)
    }

    // Restore diagram XML when DrawIO becomes ready
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loadDiagram uses refs internally and is stable
    useEffect(() => {
        // Reset restore flag when DrawIO is not ready (e.g., theme/UI change remounts it)
        if (!isDrawioReady) {
            hasDiagramRestoredRef.current = false
            setCanSaveDiagram(false)
            return
        }
        if (hasDiagramRestoredRef.current) return
        hasDiagramRestoredRef.current = true

        try {
            const savedDiagramXml = localStorage.getItem(
                STORAGE_DIAGRAM_XML_KEY,
            )
            if (savedDiagramXml) {
                // Skip validation for trusted saved diagrams
                loadDiagram(savedDiagramXml, true)
            }
        } catch (error) {
            console.error("Failed to restore diagram from localStorage:", error)
        }

        // Allow saving after restore is complete
        setTimeout(() => {
            setCanSaveDiagram(true)
        }, 500)
    }, [isDrawioReady])

    // Save diagram XML to localStorage whenever it changes (debounced)
    useEffect(() => {
        if (!canSaveDiagram) return
        if (!chartXML || chartXML.length <= 300) return

        const timeoutId = setTimeout(() => {
            localStorage.setItem(STORAGE_DIAGRAM_XML_KEY, chartXML)
        }, 1000)

        return () => clearTimeout(timeoutId)
    }, [chartXML, canSaveDiagram])

    // Track if we're expecting an export for file save (stores raw export data)
    const saveResolverRef = useRef<{
        resolver: ((data: string, fullDiagramXML?: string) => void) | null
        format: ExportFormat | null
    }>({ resolver: null, format: null })

    const handleExport = () => {
        if (drawioRef.current) {
            // Mark that this export should be saved to history
            expectHistoryExportRef.current = true
            drawioRef.current.exportDiagram({
                format: "xmlsvg",
            })
        }
    }

    const handleExportWithoutHistory = () => {
        if (drawioRef.current) {
            // Export without saving to history (for edit_diagram fetching current state)
            drawioRef.current.exportDiagram({
                format: "xmlsvg",
            })
        }
    }

    // Save current diagram to localStorage (used before theme/UI changes)
    const saveDiagramToStorage = async (): Promise<void> => {
        if (!drawioRef.current) return

        try {
            const currentXml = await Promise.race([
                new Promise<string>((resolve) => {
                    resolverRef.current = resolve
                    drawioRef.current?.exportDiagram({ format: "xmlsvg" })
                }),
                new Promise<string>((_, reject) =>
                    setTimeout(() => reject(new Error("Export timeout")), 2000),
                ),
            ])

            // Only save if diagram has meaningful content (not empty template)
            if (currentXml && currentXml.length > 300) {
                localStorage.setItem(STORAGE_DIAGRAM_XML_KEY, currentXml)
            }
        } catch (error) {
            console.error("Failed to save diagram to storage:", error)
        }
    }

    const loadDiagram = (
        chart: string,
        skipValidation?: boolean,
        options: LoadOptions = {},
    ): string | null => {
        const { mode = "open", toolCallId } = options
        if (toolCallId && committedToolCallsRef.current.has(toolCallId)) {
            // Already on the canvas: a late preview, or the message effect
            // replaying what the tool handler committed
            if (mode !== "open") return null
        }
        if (mode === "preview" && !aiTurnActiveRef.current) return null

        let xmlToLoad = chart

        // Validate XML structure before loading (unless skipped for internal use)
        if (!skipValidation) {
            const validation = validateEachPage(chart, validateAndFixXml)
            if (!validation.valid) {
                console.warn(
                    "[loadDiagram] Validation error:",
                    validation.error,
                )
                return validation.error
            }
            // Use fixed XML if auto-fix was applied
            if (validation.fixed) {
                console.log(
                    "[loadDiagram] Auto-fixed XML issues:",
                    validation.fixes,
                )
                xmlToLoad = validation.fixed
            }
        }

        // Keep chartXML in sync even when diagrams are injected (e.g., display_diagram tool)
        setChartXML(xmlToLoad)
        if (mode === "commit" && toolCallId) {
            committedToolCallsRef.current.add(toolCallId)
        }
        let applied = false
        if (
            mode !== "open" &&
            pendingLoadsRef.current === 0 &&
            canReplaceDiagram(xmlToLoad)
        ) {
            try {
                if (mode === "preview") previewDiagram(xmlToLoad)
                else commitDiagram(xmlToLoad)
                applied = true
            } catch (error) {
                console.warn("[loadDiagram] In-place update failed:", error)
            }
        }
        if (!applied && drawioRef.current) {
            // A full load replaces any preview, and its base is stale now
            resetPreview()
            // An AI change loaded in full (the user is on another page than
            // the one the AI writes): bring the user back to their page
            reselectPageRef.current = mode !== "open" ? currentPageId() : null
            pendingLoadsRef.current += 1
            drawioRef.current.load({
                xml: xmlToLoad,
            })
        }

        return null
    }

    const revertAiPreview = (toolCallId?: string) => {
        if (toolCallId) committedToolCallsRef.current.add(toolCallId)
        const base = revertPreview()
        if (base) setChartXML(base)
    }

    // Automatic resends (tool results, continuations) end and start the
    // turn again in quick succession; only a turn that stays ended finishes
    const turnEndTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    // Stable: only refs and a state setter inside
    const setAiTurnActive = useCallback((active: boolean) => {
        if (turnEndTimerRef.current) {
            clearTimeout(turnEndTimerRef.current)
            turnEndTimerRef.current = null
        }
        if (active) {
            aiTurnActiveRef.current = true
            return
        }
        turnEndTimerRef.current = setTimeout(() => {
            turnEndTimerRef.current = null
            aiTurnActiveRef.current = false
            committedToolCallsRef.current.clear()
            // Stopped, failed or out of retries mid-stream: what is shown
            // becomes one undo step, and the canvas is unlocked
            if (hasPreview()) {
                const shown = commitShownPreview()
                if (shown) setChartXML(shown)
            }
        }, 1500)
    }, [])

    const handleDiagramExport = (data: any) => {
        // Handle save to file if requested (process raw data before extraction)
        if (saveResolverRef.current.resolver) {
            const format = saveResolverRef.current.format
            // Pass data.xml (full uncompressed multi-page document) so .drawio
            // saves preserve every page, not just the first.
            saveResolverRef.current.resolver(data.data, data.xml)
            saveResolverRef.current = { resolver: null, format: null }
            // For non-xmlsvg formats, skip XML extraction as it will fail
            // Only drawio (which uses xmlsvg internally) has the content attribute
            if (format === "png" || format === "svg") {
                return
            }
        }

        const extractedXML = extractDiagramXML(data.data)
        // The full document, every page uncompressed: extractDiagramXML
        // decodes the FIRST page only. Not written to chartXML here; that is
        // kept current by loadDiagram (AI updates) and onAutoSave.
        const fullXML = data.xml ? uncompressPages(data.xml) : extractedXML
        setLatestSvg(data.data)

        // Only add to history if this was a user-initiated export
        // Limit to 20 entries to prevent memory leaks during long sessions
        const MAX_HISTORY_SIZE = 20
        if (expectHistoryExportRef.current) {
            setDiagramHistory((prev) => {
                const newHistory = [
                    ...prev,
                    {
                        svg: data.data,
                        xml: fullXML,
                    },
                ]
                // Keep only the last MAX_HISTORY_SIZE entries (circular buffer)
                return newHistory.slice(-MAX_HISTORY_SIZE)
            })
            expectHistoryExportRef.current = false
        }

        if (resolverRef.current) {
            resolverRef.current(fullXML)
            resolverRef.current = null
        }
    }

    // Draw.io autosave fires on every canvas change with the full, uncompressed
    // multi-page document. Use it as the source of truth for chartXML so manual
    // edits and multi-page diagrams are preserved (localStorage, display).
    const handleDiagramAutoSave = (data: { xml?: string }) => {
        if (!data?.xml) return
        // Don't clobber a pending restore: if we already hold a real diagram in
        // state but DrawIO isn't ready yet, we're waiting to restore it.
        if (!isDrawioReady && isRealDiagram(chartXML)) return
        setChartXML(data.xml)
    }

    const clearDiagram = () => {
        const emptyDiagram = `<mxfile><diagram name="Page-1" id="page-1"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel></diagram></mxfile>`
        // Skip validation for trusted internal template (loadDiagram also sets chartXML)
        loadDiagram(emptyDiagram, true)
        setLatestSvg("")
        setDiagramHistory([])
    }

    // Capture current diagram as PNG base64 data URL
    const capturePng = (): Promise<string> => {
        return new Promise((resolve, reject) => {
            if (!drawioRef.current) {
                reject(new Error("Draw.io editor not ready"))
                return
            }
            const timeout = setTimeout(
                () => reject(new Error("PNG capture timeout")),
                5000,
            )
            saveResolverRef.current = {
                resolver: (data: string) => {
                    clearTimeout(timeout)
                    resolve(data)
                },
                format: "png",
            }
            drawioRef.current.exportDiagram({ format: "png" })
        })
    }

    const saveDiagramToFile = (
        filename: string,
        format: ExportFormat,
        sessionId?: string,
    ) => {
        if (!drawioRef.current) {
            console.warn("Draw.io editor not ready")
            return
        }

        // Map format to draw.io export format
        const drawioFormat = format === "drawio" ? "xmlsvg" : format

        // Set up the resolver before triggering export
        saveResolverRef.current = {
            resolver: (exportData: string, fullDiagramXML?: string) => {
                let fileContent: string | Blob
                let mimeType: string
                let extension: string

                if (format === "drawio") {
                    // Prefer the complete document from the export event so all
                    // pages are saved; fall back to first-page extraction.
                    const xml = fullDiagramXML?.trim()
                        ? fullDiagramXML
                        : extractDiagramXML(exportData)
                    let xmlContent = xml
                    if (!xml.includes("<mxfile")) {
                        xmlContent = `<mxfile><diagram name="Page-1" id="page-1">${xml}</diagram></mxfile>`
                    }
                    fileContent = xmlContent
                    mimeType = "application/xml"
                    extension = ".drawio"

                    // Save to localStorage when user manually saves
                    localStorage.setItem(STORAGE_DIAGRAM_XML_KEY, xmlContent)
                } else if (format === "png") {
                    // PNG data comes as base64 data URL
                    fileContent = exportData
                    mimeType = "image/png"
                    extension = ".png"
                } else {
                    // SVG format
                    fileContent = exportData
                    mimeType = "image/svg+xml"
                    extension = ".svg"
                }

                // Log save event to Langfuse (flags the trace)
                logSaveToLangfuse(filename, format, sessionId)

                // Handle download
                let url: string
                if (
                    typeof fileContent === "string" &&
                    fileContent.startsWith("data:")
                ) {
                    // Already a data URL (PNG)
                    url = fileContent
                } else {
                    const blob = new Blob([fileContent], { type: mimeType })
                    url = URL.createObjectURL(blob)
                }

                const a = document.createElement("a")
                a.href = url
                a.download = `${filename}${extension}`
                document.body.appendChild(a)
                a.click()
                document.body.removeChild(a)

                // Delay URL revocation to ensure download completes
                if (!url.startsWith("data:")) {
                    setTimeout(() => URL.revokeObjectURL(url), 100)
                }
            },
            format,
        }

        // Export diagram - callback will be handled in handleDiagramExport
        drawioRef.current.exportDiagram({ format: drawioFormat })
    }

    // Log save event to Langfuse (just flags the trace, doesn't send content)
    const logSaveToLangfuse = async (
        filename: string,
        format: string,
        sessionId?: string,
    ) => {
        try {
            await fetch(getApiEndpoint("/api/log-save"), {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ filename, format, sessionId }),
            })
        } catch (error) {
            console.warn("Failed to log save to Langfuse:", error)
        }
    }

    return (
        <DiagramContext.Provider
            value={{
                chartXML,
                latestSvg,
                diagramHistory,
                loadDiagram,
                revertAiPreview,
                setAiTurnActive,
                handleExport,
                handleExportWithoutHistory,
                resolverRef,
                drawioRef,
                handleDiagramExport,
                handleDiagramAutoSave,
                clearDiagram,
                saveDiagramToFile,
                saveDiagramToStorage,
                capturePng,
                isDrawioReady,
                onDrawioLoad,
                resetDrawioReady,
                showSaveDialog,
                setShowSaveDialog,
            }}
        >
            {children}
        </DiagramContext.Provider>
    )
}

export function useDiagram() {
    const context = useContext(DiagramContext)
    if (context === undefined) {
        throw new Error("useDiagram must be used within a DiagramProvider")
    }
    return context
}
