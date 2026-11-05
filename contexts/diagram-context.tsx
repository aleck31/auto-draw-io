"use client"

import type React from "react"
import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react"
import { STORAGE_DIAGRAM_XML_KEY } from "@/components/chat-panel"
import type { DrawioFrameHandle } from "@/components/drawio-frame"
import type { ExportFormat } from "@/components/save-dialog"
import { getAiPageId } from "@/lib/ai-page"
import { getApiEndpoint } from "@/lib/base-path"
import { diffPageModels } from "@/lib/diagram-diff"
import { diagramFingerprint } from "@/lib/diagram-fingerprint"
import {
    pageModelXml,
    uncompressPages,
    validateEachPage,
} from "@/lib/diagram-pages"
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
    type DiagramVersion,
    loadVersions,
    MAX_VERSIONS,
    storeVersions,
    thumbnailOf,
} from "@/lib/versions"
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
    /** Each AI change that landed on the canvas, oldest first */
    versions: DiagramVersion[]
    /** The newest version the canvas shows now, if any */
    onCanvasVersionId: string | null
    /** Put a version on the canvas, as one undo step */
    restoreVersion: (id: string) => void
    /** Drop the versions of tool calls no longer in the chat */
    keepVersionsOf: (toolCallIds: Set<string>) => void
    /** The version the compare dialog shows; null when it is closed */
    compareVersionId: string | null
    openCompare: (id: string | null) => void
    /** The canvas as an SVG data URL ("" when it could not be exported) */
    captureSvg: () => Promise<string>
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
    // The canvas now, for code that runs before the next render
    const chartXMLRef = useRef("")
    chartXMLRef.current = chartXML
    const [versions, setVersions] = useState<DiagramVersion[]>([])
    const [compareVersionId, openCompare] = useState<string | null>(null)
    const [isDrawioReady, setIsDrawioReady] = useState(false)
    const [canSaveDiagram, setCanSaveDiagram] = useState(false)
    const [showSaveDialog, setShowSaveDialog] = useState(false)
    const hasCalledOnLoadRef = useRef(false)
    const drawioRef = useRef<DrawioFrameHandle | null>(null)
    const resolverRef = useRef<((value: string) => void) | null>(null)
    // The canvas before each streaming tool call's first preview
    const aiBasesRef = useRef<Map<string, string>>(new Map())
    const svgWaitersRef = useRef<((svg: string) => void)[]>([])
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
        drawioRef.current?.exportDiagram({ format: "xmlsvg" })
    }

    const captureSvg = (): Promise<string> =>
        new Promise((resolve) => {
            if (!drawioRef.current) {
                resolve("")
                return
            }
            const waiter = (svg: string) => {
                clearTimeout(timeout)
                resolve(svg)
            }
            const timeout = setTimeout(() => {
                svgWaitersRef.current = svgWaitersRef.current.filter(
                    (w) => w !== waiter,
                )
                resolve("")
            }, 5000)
            svgWaitersRef.current.push(waiter)
            drawioRef.current.exportDiagram({ format: "xmlsvg" })
        })

    // Versions are kept with the chat
    const versionsLoadedRef = useRef(false)
    useEffect(() => {
        setVersions(loadVersions())
        versionsLoadedRef.current = true
    }, [])
    useEffect(() => {
        if (!versionsLoadedRef.current) return
        const timeout = setTimeout(() => storeVersions(versions), 500)
        return () => clearTimeout(timeout)
    }, [versions])

    const addVersion = (id: string, beforeXml: string, afterXml: string) => {
        const pageId = getAiPageId()
        const { fromScratch, summary } = diffPageModels(
            pageModelXml(beforeXml, pageId),
            pageModelXml(afterXml, pageId),
        )
        setVersions((prev) => {
            if (prev.some((v) => v.id === id)) return prev
            const number = (prev.at(-1)?.number ?? 0) + 1
            const version = {
                id,
                number,
                xml: afterXml,
                pageId,
                fromScratch,
                summary,
            }
            return [...prev, version].slice(-MAX_VERSIONS)
        })
    }

    /** Called once the version is on the canvas, or its full load is queued */
    const addThumbnail = (id: string) => {
        captureSvg().then((svg) =>
            setVersions((prev) =>
                prev.map((v) =>
                    v.id === id
                        ? { ...v, svg: svg ? thumbnailOf(svg) : "" }
                        : v,
                ),
            ),
        )
    }

    const fingerprintsRef = useRef<Map<string, string>>(new Map())
    const onCanvasVersionId = useMemo(() => {
        if (!chartXML) return null
        const now = diagramFingerprint(chartXML)
        for (let i = versions.length - 1; i >= 0; i--) {
            const { id, xml } = versions[i]
            let fingerprint = fingerprintsRef.current.get(id)
            if (fingerprint === undefined) {
                fingerprint = diagramFingerprint(xml)
                fingerprintsRef.current.set(id, fingerprint)
            }
            if (fingerprint === now) return id
        }
        return null
    }, [versions, chartXML])

    const restoreVersion = (id: string) => {
        const version = versions.find((v) => v.id === id)
        if (!version || aiTurnActiveRef.current) return
        // Trusted: it passed validation when the AI made it
        loadDiagram(version.xml, true, { mode: "commit" })
    }

    const keepVersionsOf = useCallback((toolCallIds: Set<string>) => {
        setVersions((prev) => prev.filter((v) => toolCallIds.has(v.id)))
    }, [])

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
        if (
            mode === "preview" &&
            toolCallId &&
            !aiBasesRef.current.has(toolCallId)
        ) {
            aiBasesRef.current.set(toolCallId, chartXMLRef.current)
        }

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

        if (mode === "commit" && toolCallId) {
            committedToolCallsRef.current.add(toolCallId)
            addVersion(
                toolCallId,
                aiBasesRef.current.get(toolCallId) ?? chartXMLRef.current,
                xmlToLoad,
            )
            aiBasesRef.current.delete(toolCallId)
        }
        // Keep chartXML in sync even when diagrams are injected (e.g., display_diagram tool)
        setChartXML(xmlToLoad)
        chartXMLRef.current = xmlToLoad
        const newVersionId = mode === "commit" ? toolCallId : undefined
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
        // The export is answered after the load before it
        if (newVersionId) addThumbnail(newVersionId)

        return null
    }

    const revertAiPreview = (toolCallId?: string) => {
        if (toolCallId) {
            committedToolCallsRef.current.add(toolCallId)
            aiBasesRef.current.delete(toolCallId)
        }
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
        // draw.io answers an xmlsvg export as "svg"
        const isSvg = data.format === "svg" || data.format === "xmlsvg"
        if (isSvg && svgWaitersRef.current.length > 0) {
            const waiters = svgWaitersRef.current
            svgWaitersRef.current = []
            for (const waiter of waiters) waiter(data.data)
        }
        // Handle save to file if requested (process raw data before extraction).
        // A PNG capture only takes a PNG export: an xmlsvg export asked for
        // just before (the thumbnail of an AI change) can land first.
        const pending = saveResolverRef.current
        if (
            pending.resolver &&
            !(pending.format === "png" && data.format !== "png")
        ) {
            const format = pending.format
            // Pass data.xml (full uncompressed multi-page document) so .drawio
            // saves preserve every page, not just the first.
            pending.resolver(data.data, data.xml)
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
        setVersions([])
        aiBasesRef.current.clear()
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
                versions,
                onCanvasVersionId,
                restoreVersion,
                keepVersionsOf,
                compareVersionId,
                openCompare,
                captureSvg,
                loadDiagram,
                revertAiPreview,
                setAiTurnActive,
                handleExport,
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
