import "@/lib/server-dom"
import { generateText, hasToolCall, isStepCount, tool } from "ai"
import { z } from "zod"
import {
    getAIModel,
    getServerModels,
    supportsTemperature,
} from "@/lib/ai-providers"
import {
    buildDiagramViewUrl,
    buildPngUrl,
    buildRenderUrl,
    buildShortViewUrl,
} from "@/lib/diagram-link"
import {
    listPages,
    pageModelXml,
    placeOnPage,
    validateEachPage,
} from "@/lib/diagram-pages"
import {
    createDiagram,
    getCurrentDiagram,
    writeDiagramVersion,
} from "@/lib/diagram-store"
import {
    hideImageData,
    imageRefNote,
    restoreImageData,
} from "@/lib/embedded-images"
import { AGENT_SYSTEM_PROMPT } from "@/lib/mcp-drawing-guide"
import { getShapeLibraryTool } from "@/lib/tools"
import { validateAndFixXml, wrapWithMxFile } from "@/lib/utils"

/**
 * Headless diagram generation shared by the agent REST endpoint
 * (/api/agent/diagram) and the MCP endpoint (/api/mcp).
 *
 * Reuses the web client's model selection, drawing guide, shape-library tool and
 * XML validation, with its own prompt (lib/mcp-drawing-guide.ts), and returns a
 * plain result instead of a stream.
 */

export interface GenerateDiagramParams {
    prompt: string
    currentXml?: string
    /** A stored diagram to edit: the result becomes its next version */
    diagramId?: string
    modelId?: string
    abortSignal?: AbortSignal
    /**
     * Called with human-readable progress as generation proceeds. Long diagrams
     * can take minutes; callers use this to keep the connection alive (e.g. MCP
     * progress notifications) so proxies don't time the request out.
     */
    onProgress?: (message: string) => void
}

export interface SavedDiagram {
    mxfile: string
    notes?: string[]
    /** Id of the stored diagram; agents use it to fetch the XML on demand. */
    id: string
    /** Version of the diagram this result stored */
    version: number
    /** The diagram's revision after this write; the base of the next edit */
    revision: number
    /** Browser edits this write replaced were kept as this version */
    keptUserVersion?: number
    /** Short link that opens this diagram in the app (needs APP_BASE_URL). */
    viewUrl?: string
    /** Render-only page (just the diagram, no app UI) */
    renderUrl?: string
    /** PNG of the current version (needs the access code) */
    pngUrl?: string
    /**
     * Self-contained link with the diagram encoded in the URL fragment. Longer,
     * but keeps working after the diagram expires.
     */
    durableViewUrl?: string
    /** Number of cells in the diagram, for a short summary. */
    cellCount: number
}

export interface GenerateDiagramResult extends SavedDiagram {
    /** The bare mxCells the model wrote */
    xml: string
}

export class DiagramGenerationError extends Error {
    status: number
    constructor(message: string, status = 500) {
        super(message)
        this.name = "DiagramGenerationError"
        this.status = status
    }
}

/**
 * What the model is shown of the diagram to edit: its first page, and the
 * list of pages when there are several (the other pages stay as they are).
 */
function currentDiagramMessage(currentXml: string, prompt: string): string {
    const pages = listPages(currentXml)
    // Pictures as short references; the drawing gets them back
    const page = hideImageData(pageModelXml(currentXml, null) ?? currentXml)
    const images = imageRefNote(page)
    const pagesNote =
        pages.length > 1
            ? `\n\nThe file has ${pages.length} pages: ${pages
                  .slice(0, 50)
                  .map(
                      (p, i) =>
                          `${i + 1}. ${JSON.stringify(p.name.slice(0, 100))}`,
                  )
                  .join(
                      ", ",
                  )}. This is page 1; your diagram replaces it and the other pages are kept.`
            : ""
    return `Current diagram XML:\n"""xml\n${page}\n"""${pagesNote}${images ? `\n\n${images}` : ""}\n\n${prompt}`
}

/**
 * Wraps, validates and repairs diagram XML (bare mxCells, an mxGraphModel or
 * an mxfile), page by page. Throws when it cannot be repaired.
 */
export function validDiagramXml(xml: string): {
    mxfile: string
    fixes: string[]
} {
    const mxfile = wrapWithMxFile(xml)
    const validation = validateEachPage(mxfile, validateAndFixXml)
    // Still invalid after the repairs; `fixed` then holds a partial repair
    if (!validation.valid) {
        throw new DiagramGenerationError(
            `Invalid diagram XML: ${validation.error}`,
            400,
        )
    }
    return {
        mxfile: validation.fixed || mxfile,
        fixes: validation.fixes ?? [],
    }
}

/**
 * Stores a diagram, as a new one or as the next version of diagramId. With
 * baseRevision, refuses when the diagram changed since that revision.
 */
export function saveDiagram(
    mxfile: string,
    options: {
        diagramId?: string
        baseRevision?: number
        source?: "agent" | "restore"
        notes?: string[]
    },
): SavedDiagram {
    let stored: {
        id: string
        version: number
        revision: number
        keptUserVersion?: number
    }
    if (options.diagramId) {
        const written = writeDiagramVersion(
            options.diagramId,
            mxfile,
            options.source ?? "agent",
            options.baseRevision,
        )
        if (!written.ok && written.reason === "not-found") {
            throw diagramNotFound(options.diagramId)
        }
        if (!written.ok) {
            throw new DiagramChangedError(
                options.diagramId,
                options.baseRevision ?? 0,
                written.current.revision,
                written.current.source,
            )
        }
        const { ok: _, ...rest } = written
        stored = { id: options.diagramId, ...rest }
    } else {
        stored = createDiagram(mxfile)
    }
    const viewUrl = buildShortViewUrl(stored.id)
    const renderUrl = buildRenderUrl(stored.id)
    const pngUrl = buildPngUrl(stored.id)
    const durableViewUrl = buildDiagramViewUrl(mxfile)
    return {
        mxfile,
        ...stored,
        cellCount: mxfile.split("<mxCell").length - 1,
        ...(options.notes?.length && { notes: options.notes }),
        ...(viewUrl && { viewUrl }),
        ...(renderUrl && { renderUrl }),
        ...(pngUrl && { pngUrl }),
        ...(durableViewUrl && { durableViewUrl }),
    }
}

/** The diagram changed after the revision a write was based on */
export class DiagramChangedError extends DiagramGenerationError {
    constructor(
        id: string,
        baseRevision: number,
        public revision: number,
        source: string,
    ) {
        super(
            `Diagram ${id} changed since revision ${baseRevision}: it is now at revision ${revision}${source === "user" ? ", edited by the user in the browser" : ""}. Nothing was saved. Read it with get_diagram and make the change on the current diagram.`,
            409,
        )
        this.name = "DiagramChangedError"
    }
}

export function diagramNotFound(id: string): DiagramGenerationError {
    return new DiagramGenerationError(
        `Diagram ${id} not found: diagrams expire 30 days after their last change.`,
        404,
    )
}

export async function generateDiagram({
    prompt,
    currentXml: givenXml,
    diagramId,
    modelId: requestedModel,
    abortSignal,
    onProgress,
}: GenerateDiagramParams): Promise<GenerateDiagramResult> {
    // Restrict model selection to the configured server models.
    let overrides: { modelId?: string } | undefined
    if (requestedModel) {
        if (!getServerModels().includes(requestedModel)) {
            throw new DiagramGenerationError(
                `Model "${requestedModel}" is not available on this server.`,
                400,
            )
        }
        overrides = { modelId: requestedModel }
    }

    // An edit of a stored diagram is saved only if nobody changed it meanwhile
    let currentXml = givenXml
    let baseRevision: number | undefined
    if (!currentXml && diagramId) {
        const current = getCurrentDiagram(diagramId)
        if (!current) throw diagramNotFound(diagramId)
        currentXml = current.xml
        baseRevision = current.revision
    }

    let capturedXml: string | null = null

    const { model, providerOptions, headers, modelId, reasoning } =
        getAIModel(overrides)

    onProgress?.(`Generating diagram with ${modelId}`)

    const result = await generateText({
        model,
        // Its own prompt: the chat's describes tools and a canvas this has not
        instructions: AGENT_SYSTEM_PROMPT,
        maxOutputTokens: process.env.MAX_OUTPUT_TOKENS
            ? parseInt(process.env.MAX_OUTPUT_TOKENS, 10)
            : 64000,
        // The diagram is the answer: no round trip for a closing sentence
        stopWhen: [isStepCount(5), hasToolCall("display_diagram")],
        ...(abortSignal && { abortSignal }),
        onStepEnd: () => {
            onProgress?.("Still working on the diagram")
        },
        ...(process.env.TEMPERATURE !== undefined &&
            supportsTemperature(modelId) && {
                temperature: parseFloat(process.env.TEMPERATURE),
            }),
        ...(providerOptions && { providerOptions }),
        ...(reasoning && { reasoning }),
        ...(headers && { headers }),
        messages: [
            {
                role: "user",
                content: currentXml
                    ? currentDiagramMessage(currentXml, prompt)
                    : prompt,
            },
        ],
        tools: {
            // The model returns the diagram through this tool, mirroring the
            // web client's display_diagram contract (bare mxCells).
            display_diagram: tool({
                description:
                    "Display the diagram. Pass ONLY the mxCell elements - wrapper tags (<mxfile>, <mxGraphModel>, <root>) and root cells (id 0/1) are added automatically. Every mxCell needs a unique id starting from 2 and a valid parent (use 1 for top-level).",
                inputSchema: z.object({
                    xml: z
                        .string()
                        .describe("The bare <mxCell> elements to render"),
                }),
                execute: async ({ xml }: { xml: string }) => {
                    capturedXml = xml
                    onProgress?.("Diagram XML received, validating")
                    return "Diagram received."
                },
            }),
            get_shape_library: {
                ...getShapeLibraryTool,
                execute: async (args: { library: string }) => {
                    onProgress?.(`Looking up ${args.library} icon library`)
                    return getShapeLibraryTool.execute(args)
                },
            },
        },
    })

    if (!capturedXml) {
        throw new DiagramGenerationError(
            `The model did not produce a diagram.${
                result.text ? ` Model said: ${result.text.slice(0, 500)}` : ""
            }`,
            502,
        )
    }

    let drawn: { mxfile: string; fixes: string[] }
    try {
        drawn = validDiagramXml(restoreImageData(capturedXml, currentXml))
    } catch (error) {
        throw new DiagramGenerationError(
            `The model's diagram is invalid: ${(error as Error).message}`,
            502,
        )
    }
    // An edit replaces the first page of the current file; its other pages stay
    const finalMxfile = currentXml
        ? placeOnPage(drawn.mxfile, currentXml, null)
        : drawn.mxfile
    return {
        xml: capturedXml,
        ...saveDiagram(finalMxfile, {
            diagramId,
            baseRevision,
            notes: drawn.fixes,
        }),
    }
}

/**
 * Shared access-code gate for agent-facing endpoints (same policy as /api/chat
 * for server-side models).
 */
export function checkAgentAccess(req: Request): boolean {
    const accessCode = process.env.ACCESS_CODE?.trim()
    if (!accessCode) return true
    const provided = req.headers.get("x-access-code")
    return provided === accessCode
}
