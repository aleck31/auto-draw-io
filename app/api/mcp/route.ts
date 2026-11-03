import {
    type CallToolResult,
    createMcpHandler,
    McpServer,
    type ServerContext,
} from "@modelcontextprotocol/server"
import { z } from "zod"
import {
    checkAgentAccess,
    DiagramGenerationError,
    diagramNotFound,
    generateDiagram,
    type SavedDiagram,
    saveDiagram,
    validDiagramXml,
} from "@/lib/agent-diagram"
import { listPages, pageModelXml, placeOnPage } from "@/lib/diagram-pages"
import { renderDiagramForModel } from "@/lib/diagram-render"
import { SCREENSHOT_CHECKLIST } from "@/lib/diagram-screenshot"
import {
    getDiagram,
    getDiagramVersion,
    getStoredDiagram,
} from "@/lib/diagram-store"
import { MCP_DRAWING_GUIDE } from "@/lib/mcp-drawing-guide"
import { getShapeLibraryTool } from "@/lib/tools"
import { applyDiagramOperations } from "@/lib/utils"

export const runtime = "nodejs"
export const maxDuration = 600

/**
 * MCP (Model Context Protocol) endpoint over Streamable HTTP.
 *
 * Lets MCP-capable agents (Claude Desktop, Cursor, Cline, Claude Code) draw
 * draw.io diagrams by pointing at this URL - no local install or build needed:
 *
 *   {
 *     "mcpServers": {
 *       "auto-drawio": {
 *         "url": "https://your-deployment/api/mcp",
 *         "headers": { "x-access-code": "your-code" }
 *       }
 *     }
 *   }
 *
 * Two ways to draw. The agent writes the XML itself (create_diagram,
 * edit_cells; the server validates, stores, versions and renders it), or the
 * server's own model draws from a description (generate_diagram,
 * edit_diagram). Both use the same stored diagrams and cell ids.
 *
 * Serves both 2025-era clients (stateless, a fresh server per request) and the
 * 2026-07-28 revision, so it works behind load balancers without sticky sessions.
 */

const DIAGRAM_HINT =
    "Be specific about components and how they connect, e.g. 'AWS: users -> CloudFront -> ALB -> EC2 in private subnet -> RDS Multi-AZ'."

const INSTRUCTIONS = `Draws draw.io diagrams that are stored on the server with an id and a version history (diagrams expire 30 days after their last change).
To draw the XML yourself: call get_drawing_guide once, get_shape_library before using any icon library (AWS, Azure, GCP, Kubernetes...), then create_diagram, and edit_cells for changes. Pass screenshot: true on the last call of a drawing round to see the result. Read the current diagram with get_diagram: the user may have edited it in the browser.
To have the server's model draw from a description instead: generate_diagram and edit_diagram.`

const SCREENSHOT_SCHEMA = z
    .boolean()
    .optional()
    .describe(
        "Also return a PNG of the result, to check for overlaps and connectors crossing shapes. Adds 1 to 3 s.",
    )

const MODEL_CHECKLIST = SCREENSHOT_CHECKLIST.replaceAll(
    "edit_diagram",
    "edit_cells",
)

/**
 * Wraps a diagram call with MCP progress notifications.
 *
 * Complex diagrams can take several minutes. Streaming progress keeps bytes
 * flowing so proxies/CDNs (CloudFront's response timeout is an idle timeout)
 * don't cut the request, and MCP clients reset their own timeouts on progress.
 */
async function withProgress<T>(
    ctx: ServerContext,
    run: (onProgress: (message: string) => void) => Promise<T>,
): Promise<T> {
    const progressToken = ctx.mcpReq._meta?.progressToken
    let counter = 0

    const notify = (message: string) => {
        if (progressToken === undefined) return
        counter += 1
        // Fire-and-forget: a failed heartbeat must not fail generation.
        void ctx.mcpReq
            .notify({
                method: "notifications/progress",
                params: { progressToken, progress: counter, message },
            })
            .catch(() => {})
    }

    // Heartbeat so idle timeouts never trigger during long model calls.
    const heartbeat = setInterval(
        () => notify("Working on the diagram"),
        10_000,
    )
    try {
        return await run(notify)
    } finally {
        clearInterval(heartbeat)
    }
}

const text = (value: string) => ({ type: "text" as const, text: value })

function toError(error: unknown): CallToolResult {
    return {
        isError: true,
        content: [
            text(
                error instanceof Error
                    ? error.message
                    : "The diagram request failed",
            ),
        ],
    }
}

/** One short paragraph about a stored diagram, with its links */
function describeSaved(saved: SavedDiagram, verb: string): string {
    const lines = [
        `${verb} diagram ${saved.id}, version ${saved.version} (${saved.cellCount} cells).`,
    ]
    if (saved.notes?.length)
        lines.push(`Auto-fixes: ${saved.notes.join("; ")}.`)
    if (saved.viewUrl) lines.push(`Open/edit in the browser: ${saved.viewUrl}`)
    if (saved.pngUrl) {
        lines.push(
            `PNG for documents: ${saved.pngUrl} (send the x-access-code header).`,
        )
    }
    return lines.join("\n")
}

/** The checklist and a PNG for the model, or a note why there is none */
async function screenshotContent(
    id: string,
    version?: number,
): Promise<CallToolResult["content"]> {
    try {
        const data = await renderDiagramForModel(id, version)
        return [
            { type: "image" as const, data, mimeType: "image/png" },
            text(MODEL_CHECKLIST),
        ]
    } catch (error) {
        console.error("[mcp] screenshot:", error)
        return [
            text(
                `Screenshot unavailable: ${error instanceof Error ? error.message : "rendering failed"}.`,
            ),
        ]
    }
}

async function savedResult(
    saved: SavedDiagram,
    verb: string,
    screenshot: boolean | undefined,
): Promise<CallToolResult> {
    const content: CallToolResult["content"] = [
        text(describeSaved(saved, verb)),
    ]
    if (screenshot) {
        content.push(...(await screenshotContent(saved.id, saved.version)))
    }
    return { content }
}

/** The first page of a stored diagram as XML, with a note on the other pages */
function pageForAgent(xml: string): string {
    const pages = listPages(xml)
    const model = pageModelXml(xml, null) ?? xml
    const note =
        pages.length > 1
            ? `\nThe file has ${pages.length} pages (${pages.map((p) => JSON.stringify(p.name)).join(", ")}); this is page 1, the one the tools edit and render.`
            : ""
    return `\`\`\`xml\n${model}\n\`\`\`${note}`
}

function buildServer(): McpServer {
    const server = new McpServer(
        { name: "auto-drawio", version: "1.0.0" },
        { instructions: INSTRUCTIONS },
    )

    // ---- Drawing the XML yourself ------------------------------------------

    server.registerTool(
        "get_drawing_guide",
        {
            title: "Get the drawing guide",
            description:
                "The XML format and the layout, labelling and connector-routing rules for good draw.io diagrams. Call it once before your first create_diagram.",
            inputSchema: z.object({}),
        },
        async () => ({ content: [text(MCP_DRAWING_GUIDE)] }),
    )

    server.registerTool(
        "get_shape_library",
        {
            title: "Get an icon library",
            description: `${getShapeLibraryTool.description}\n\nAlways call it before using icons from a library; never guess style names.`,
            inputSchema: getShapeLibraryTool.inputSchema,
        },
        async ({ library }) => ({
            content: [text(await getShapeLibraryTool.execute({ library }))],
        }),
    )

    server.registerTool(
        "create_diagram",
        {
            title: "Create a diagram from XML",
            description:
                "Store a new diagram you wrote as draw.io XML: bare mxCell elements (most common), an <mxGraphModel> or an <mxfile>. The XML is validated and small problems are fixed; returns the diagram id, version 1 and links. See get_drawing_guide for the format.",
            inputSchema: z.object({
                xml: z.string().min(1).max(500_000).describe("The diagram XML"),
                screenshot: SCREENSHOT_SCHEMA,
            }),
        },
        async ({ xml, screenshot }) => {
            try {
                const valid = validDiagramXml(xml)
                const saved = saveDiagram(valid.mxfile, { notes: valid.fixes })
                return await savedResult(saved, "Created", screenshot)
            } catch (error) {
                return toError(error)
            }
        },
    )

    server.registerTool(
        "edit_cells",
        {
            title: "Edit cells of a diagram",
            description:
                "Change a stored diagram cell by cell: update (replace a cell with a whole new mxCell, same id), add (append a cell) or delete (a cell, its children and the connectors attached to it). The operations apply together or not at all; on failure each problem is listed and nothing changes. Saves the result as the next version. Ids come from get_diagram or your own XML.",
            inputSchema: z.object({
                diagram_id: z.string().describe("Id of the diagram to edit"),
                operations: z
                    .array(
                        z.object({
                            operation: z.enum(["update", "add", "delete"]),
                            cell_id: z
                                .string()
                                .describe(
                                    "Id of the cell; for update and add it must match the id in new_xml",
                                ),
                            new_xml: z
                                .string()
                                .optional()
                                .describe(
                                    "The complete mxCell element, for update and add",
                                ),
                        }),
                    )
                    .min(1)
                    .max(200),
                screenshot: SCREENSHOT_SCHEMA,
            }),
        },
        async ({ diagram_id, operations, screenshot }) => {
            try {
                const current = getDiagramVersion(diagram_id)
                if (!current) throw diagramNotFound(diagram_id)
                const page = pageModelXml(current.xml, null)
                if (!page) {
                    throw new DiagramGenerationError(
                        "The stored diagram has no page to edit.",
                    )
                }
                const { result, errors } = applyDiagramOperations(
                    page,
                    operations,
                )
                if (errors.length) {
                    return toError(
                        new Error(
                            `Nothing was changed; the diagram is still version ${current.version}. Problems:\n${errors
                                .map(
                                    (e) =>
                                        `- ${e.type} ${e.cellId || "(document)"}: ${e.message}`,
                                )
                                .join(
                                    "\n",
                                )}\nCall get_diagram for the current cell ids if it was changed elsewhere.`,
                        ),
                    )
                }
                const valid = validDiagramXml(result)
                const saved = saveDiagram(
                    placeOnPage(valid.mxfile, current.xml, null),
                    { diagramId: diagram_id, notes: valid.fixes },
                )
                return await savedResult(saved, "Edited", screenshot)
            } catch (error) {
                return toError(error)
            }
        },
    )

    server.registerTool(
        "get_diagram",
        {
            title: "Read a diagram",
            description:
                "The XML of a stored diagram (its first page), its version and the version history. Includes changes the user made in the browser, so read it before editing a diagram you have not just written.",
            inputSchema: z.object({
                diagram_id: z.string(),
                version: z
                    .number()
                    .int()
                    .positive()
                    .optional()
                    .describe("An earlier version; the current one by default"),
            }),
        },
        async ({ diagram_id, version }) => {
            const stored = getStoredDiagram(diagram_id)
            const shown = stored && getDiagramVersion(diagram_id, version)
            if (!stored || !shown) {
                return toError(
                    version && stored
                        ? new Error(
                              `Version ${version} of ${diagram_id} is not kept (only the last 20 are).`,
                          )
                        : diagramNotFound(diagram_id),
                )
            }
            const history = stored.versions
                .map((v) => `${v.version} (${v.source})`)
                .join(", ")
            const current = stored.versions.at(-1)?.version
            return {
                content: [
                    text(
                        `Diagram ${diagram_id}, version ${shown.version}${shown.version === current ? " (current)" : `; the current version is ${current}`}. Versions kept: ${history}.\n${pageForAgent(shown.xml)}`,
                    ),
                ],
            }
        },
    )

    server.registerTool(
        "screenshot_diagram",
        {
            title: "See a diagram",
            description:
                "Render a stored diagram (its first page) and return it as a PNG image you can look at, with a checklist of problems to look for.",
            inputSchema: z.object({
                diagram_id: z.string(),
                version: z.number().int().positive().optional(),
            }),
        },
        async ({ diagram_id, version }) => {
            const shown = getDiagramVersion(diagram_id, version)
            if (!shown) return toError(diagramNotFound(diagram_id))
            const content = await screenshotContent(diagram_id, shown.version)
            const failed = content.length === 1
            return { content, ...(failed && { isError: true }) }
        },
    )

    server.registerTool(
        "restore_version",
        {
            title: "Restore an earlier version",
            description:
                "Make an earlier version of a diagram the current one. It is saved as a new version, so nothing is lost.",
            inputSchema: z.object({
                diagram_id: z.string(),
                version: z.number().int().positive(),
            }),
        },
        async ({ diagram_id, version }) => {
            try {
                const earlier = getDiagramVersion(diagram_id, version)
                if (!earlier) {
                    throw getStoredDiagram(diagram_id)
                        ? new Error(
                              `Version ${version} of ${diagram_id} is not kept (only the last 20 are).`,
                          )
                        : diagramNotFound(diagram_id)
                }
                const saved = saveDiagram(earlier.xml, {
                    diagramId: diagram_id,
                    source: "restore",
                })
                return await savedResult(
                    saved,
                    `Restored version ${version} of`,
                    false,
                )
            } catch (error) {
                return toError(error)
            }
        },
    )

    // ---- The server's model draws ------------------------------------------

    server.registerTool(
        "generate_diagram",
        {
            title: "Generate a draw.io diagram",
            description: `Have the server's model draw a diagram (architecture diagram, flowchart, cloud design) from a natural-language description; can take minutes. Supports AWS/Azure/GCP/Kubernetes icon libraries. Returns the diagram id and links; get_diagram reads the XML, edit_cells and edit_diagram change it. ${DIAGRAM_HINT}`,
            inputSchema: z.object({
                description: z
                    .string()
                    .describe(`What to draw. ${DIAGRAM_HINT}`),
            }),
        },
        async ({ description }, ctx) => {
            try {
                const saved = await withProgress(ctx, (onProgress) =>
                    generateDiagram({ prompt: description, onProgress }),
                )
                return await savedResult(saved, "Generated", false)
            } catch (error) {
                console.error("[mcp] generate_diagram:", error)
                return toError(error)
            }
        },
    )

    server.registerTool(
        "edit_diagram",
        {
            title: "Edit a diagram with the server's model",
            description:
                "Have the server's model change a diagram from a description of the change. With diagram_id the result is that diagram's next version; pass current_xml instead for a diagram from elsewhere (stored as a new diagram).",
            inputSchema: z.object({
                change: z
                    .string()
                    .describe(
                        "The change to make, e.g. 'add an ElastiCache cluster between the app tier and RDS'",
                    ),
                diagram_id: z
                    .string()
                    .optional()
                    .describe("Id of a diagram from a previous call"),
                current_xml: z
                    .string()
                    .optional()
                    .describe(
                        "The diagram XML to modify; only needed when diagram_id is unavailable",
                    ),
            }),
        },
        async ({ change, diagram_id, current_xml }, ctx) => {
            if (!diagram_id && !current_xml) {
                return toError(
                    new Error("Provide either diagram_id or current_xml."),
                )
            }
            try {
                const saved = await withProgress(ctx, (onProgress) =>
                    generateDiagram({
                        prompt: change,
                        ...(diagram_id
                            ? { diagramId: diagram_id }
                            : { currentXml: current_xml }),
                        onProgress,
                    }),
                )
                return await savedResult(saved, "Edited", false)
            } catch (error) {
                console.error("[mcp] edit_diagram:", error)
                return toError(error)
            }
        },
    )

    server.registerTool(
        "get_diagram_xml",
        {
            title: "Read a diagram's whole file",
            description:
                "The whole .drawio file of a diagram (every page), for saving it. To read or edit the diagram use get_diagram.",
            inputSchema: z.object({ diagram_id: z.string() }),
        },
        async ({ diagram_id }) => {
            const xml = getDiagram(diagram_id)
            if (!xml) return toError(diagramNotFound(diagram_id))
            return { content: [text(`\`\`\`xml\n${xml}\n\`\`\``)] }
        },
    )

    return server
}

const mcpHandler = createMcpHandler(() => buildServer(), {
    // Always stream: in "auto" mode a 2026-era response only upgrades to SSE
    // (and starts keepalives) once the handler emits a message, so a client
    // without a progressToken would get no bytes for minutes and hit idle
    // timeouts on load balancers/CDNs.
    responseMode: "sse",
    onerror: (error) => console.error("[mcp] transport error:", error),
})

async function handle(req: Request): Promise<Response> {
    if (!checkAgentAccess(req)) {
        return Response.json(
            { error: "Invalid or missing access code" },
            { status: 401 },
        )
    }

    try {
        return await mcpHandler.fetch(req)
    } catch (error) {
        console.error("[mcp] transport error:", error)
        return Response.json({ error: "MCP request failed" }, { status: 500 })
    }
}

export const POST = handle
export const GET = handle
export const DELETE = handle
