import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import { z } from "zod"
import {
    checkAgentAccess,
    DiagramGenerationError,
    generateDiagram,
} from "@/lib/agent-diagram"

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
        mxfile: string
        notes?: string[]
        viewUrl?: string
    }) => {
        const notes = result.notes?.length
            ? ` Auto-fixes applied: ${result.notes.join("; ")}.`
            : ""
        const view = result.viewUrl
            ? `\n\nOpen the rendered diagram: ${result.viewUrl}`
            : ""
        // Two blocks: a short summary (with the preview link) first, so it is
        // not buried under the diagram, then the XML on its own.
        return {
            content: [
                {
                    type: "text" as const,
                    text: `Diagram generated (${result.mxfile.split("<mxCell").length - 1} cells).${notes}${view}`,
                },
                {
                    type: "text" as const,
                    text: `Save this as a .drawio file to open it in draw.io:\n\n\`\`\`xml\n${result.mxfile}\n\`\`\``,
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
            description: `Generate a draw.io diagram (architecture diagram, flowchart, cloud design) from a natural-language description. Supports AWS/Azure/GCP/Kubernetes icon libraries. Returns a complete .drawio (mxfile) document. ${DIAGRAM_HINT}`,
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
                "Modify an existing draw.io diagram. Provide the current diagram XML (mxfile or bare mxCells) plus the change to make. Returns the updated .drawio document.",
            inputSchema: {
                current_xml: z
                    .string()
                    .describe("The existing diagram XML to modify"),
                change: z
                    .string()
                    .describe(
                        "The change to make, e.g. 'add an ElastiCache cluster between the app tier and RDS'",
                    ),
            },
        },
        async ({ current_xml, change }, extra) => {
            try {
                return toResult(
                    await withProgress(extra, (onProgress) =>
                        generateDiagram({
                            prompt: change,
                            currentXml: current_xml,
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
