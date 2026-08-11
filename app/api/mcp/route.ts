import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import { z } from "zod"
import {
    checkAgentAccess,
    DiagramGenerationError,
    generateDiagram,
} from "@/lib/agent-diagram"
import { getDiagram } from "@/lib/diagram-store"

export const runtime = "nodejs"
export const maxDuration = 600

/**
 * MCP (Model Context Protocol) endpoint over Streamable HTTP.
 *
 * Lets MCP-capable agents (Claude Desktop, Cursor, Cline, Claude Code) generate
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
 * Runs stateless (a fresh server + transport per request) so it works behind
 * load balancers and on serverless platforms without sticky sessions.
 */

const DIAGRAM_HINT =
    "Be specific about components and how they connect, e.g. 'AWS: users -> CloudFront -> ALB -> EC2 in private subnet -> RDS Multi-AZ'."

/**
 * Wraps a diagram call with MCP progress notifications.
 *
 * Complex diagrams can take several minutes. Streaming progress keeps bytes
 * flowing so proxies/CDNs (CloudFront's response timeout is an idle timeout)
 * don't cut the request, and MCP clients reset their own timeouts on progress.
 */
async function withProgress<T>(
    extra: {
        _meta?: { progressToken?: string | number }
        sendNotification: (n: any) => Promise<void>
    },
    run: (onProgress: (message: string) => void) => Promise<T>,
): Promise<T> {
    const progressToken = extra._meta?.progressToken
    let counter = 0

    const notify = (message: string) => {
        if (progressToken === undefined) return
        counter += 1
        // Fire-and-forget: a failed heartbeat must not fail generation.
        void extra
            .sendNotification({
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

function buildServer(): McpServer {
    const server = new McpServer({ name: "auto-drawio", version: "1.0.0" })

    const toResult = (result: {
        id: string
        cellCount: number
        notes?: string[]
        viewUrl?: string
        renderUrl?: string
    }) => {
        const notes = result.notes?.length
            ? ` Auto-fixes: ${result.notes.join("; ")}.`
            : ""
        const view = result.viewUrl
            ? `\nOpen/edit in the browser: ${result.viewUrl}`
            : ""
        const render = result.renderUrl
            ? `\nTo get a PNG: open ${result.renderUrl} in a headless browser and screenshot the svg element (that page has no app UI, only the diagram).`
            : ""
        // Compact on purpose: returning the full XML here would add several KB
        // to the agent's context on every call. Agents fetch it with
        // get_diagram_xml only when they actually need the markup.
        return {
            content: [
                {
                    type: "text" as const,
                    text: `Diagram created (${result.cellCount} cells).${notes}${view}${render}\nDiagram id: ${result.id} - pass it to edit_diagram to modify it, or get_diagram_xml to read the XML.`,
                },
            ],
        }
    }

    const toError = (error: unknown) => ({
        isError: true,
        content: [
            {
                type: "text" as const,
                text:
                    error instanceof DiagramGenerationError ||
                    error instanceof Error
                        ? error.message
                        : "Diagram generation failed",
            },
        ],
    })

    server.registerTool(
        "generate_diagram",
        {
            title: "Generate a draw.io diagram",
            description: `Generate a draw.io diagram (architecture diagram, flowchart, cloud design) from a natural-language description. Supports AWS/Azure/GCP/Kubernetes icon libraries. Returns a diagram id plus links: one to open/edit it in the browser, and a render-only page you can screenshot with a headless browser to get a PNG. Use get_diagram_xml if you need the XML itself. ${DIAGRAM_HINT}`,
            inputSchema: {
                description: z
                    .string()
                    .describe(`What to draw. ${DIAGRAM_HINT}`),
            },
        },
        async ({ description }, extra) => {
            try {
                return toResult(
                    await withProgress(extra, (onProgress) =>
                        generateDiagram({ prompt: description, onProgress }),
                    ),
                )
            } catch (error) {
                console.error("[mcp] generate_diagram:", error)
                return toError(error)
            }
        },
    )

    server.registerTool(
        "edit_diagram",
        {
            title: "Edit an existing draw.io diagram",
            description:
                "Modify an existing diagram. Identify it with diagram_id (from a previous generate/edit call) - or pass current_xml when the diagram came from elsewhere. Returns a new diagram id and link.",
            inputSchema: {
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
            },
        },
        async ({ change, diagram_id, current_xml }, extra) => {
            let baseXml = current_xml
            if (!baseXml && diagram_id) {
                const stored = getDiagram(diagram_id)
                if (!stored) {
                    return toError(
                        new Error(
                            `Diagram ${diagram_id} not found - links expire after 30 days and are cleared on restart. Pass current_xml instead, or generate a new diagram.`,
                        ),
                    )
                }
                baseXml = stored
            }
            if (!baseXml) {
                return toError(
                    new Error("Provide either diagram_id or current_xml."),
                )
            }

            try {
                return toResult(
                    await withProgress(extra, (onProgress) =>
                        generateDiagram({
                            prompt: change,
                            currentXml: baseXml,
                            onProgress,
                        }),
                    ),
                )
            } catch (error) {
                console.error("[mcp] edit_diagram:", error)
                return toError(error)
            }
        },
    )

    server.registerTool(
        "get_diagram_xml",
        {
            title: "Read a diagram's XML",
            description:
                "Return the full draw.io XML for a diagram id. Use this only when you need the markup itself (to inspect structure or save a .drawio file) - editing can be done with edit_diagram by id.",
            inputSchema: {
                diagram_id: z
                    .string()
                    .describe(
                        "Id returned by generate_diagram or edit_diagram",
                    ),
            },
        },
        async ({ diagram_id }) => {
            const xml = getDiagram(diagram_id)
            if (!xml) {
                return toError(
                    new Error(
                        `Diagram ${diagram_id} not found - links expire after 30 days and are cleared on restart.`,
                    ),
                )
            }
            return {
                content: [
                    {
                        type: "text" as const,
                        text: `\`\`\`xml\n${xml}\n\`\`\``,
                    },
                ],
            }
        },
    )

    return server
}

async function handle(req: Request): Promise<Response> {
    if (!checkAgentAccess(req)) {
        return Response.json(
            { error: "Invalid or missing access code" },
            { status: 401 },
        )
    }

    const server = buildServer()
    // Stateless (no session id) so any replica can serve any request.
    // SSE streaming (enableJsonResponse omitted) lets us emit progress
    // notifications during multi-minute generations, which keeps idle
    // timeouts on CDNs/load balancers from cutting the connection.
    const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
    })

    try {
        await server.connect(transport)
        return await transport.handleRequest(req)
    } catch (error) {
        console.error("[mcp] transport error:", error)
        return Response.json({ error: "MCP request failed" }, { status: 500 })
    }
}

export const POST = handle
export const GET = handle
export const DELETE = handle
