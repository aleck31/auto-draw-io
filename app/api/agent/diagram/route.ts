import { NextResponse } from "next/server"
import { z } from "zod"
import {
    checkAgentAccess,
    DiagramGenerationError,
    generateDiagram,
} from "@/lib/agent-diagram"
import { jsonWithHeartbeat } from "@/lib/stream-heartbeat"

export const runtime = "nodejs"
export const maxDuration = 600

/**
 * Headless diagram generation for AI agents.
 *
 * Unlike /api/chat (which speaks the UI message-stream protocol for the web
 * client), this returns a single JSON payload so any agent can request a
 * diagram and get XML back. MCP clients can use /api/mcp instead.
 *
 * POST body:
 *   prompt      (required) natural-language description of the diagram
 *   currentXml  (optional) existing diagram to modify, as mxfile or bare mxCells
 *   modelId     (optional) server model to use; must be in AI_MODELS
 *
 * Response: { xml, mxfile, notes? }
 *
 * A diagram can take minutes. When it takes longer than 20 s the response
 * starts as 200 and sends a space every 20 s until the JSON follows, so load
 * balancers don't close it as idle; a failure after that is { error, status }.
 */

const RequestSchema = z.object({
    prompt: z.string().min(1).max(20000),
    currentXml: z.string().max(500000).optional(),
    modelId: z.string().max(200).optional(),
})

export async function POST(req: Request) {
    if (!checkAgentAccess(req)) {
        return NextResponse.json(
            { error: "Invalid or missing access code" },
            { status: 401 },
        )
    }

    let body: unknown
    try {
        body = await req.json()
    } catch {
        return NextResponse.json(
            { error: "Invalid JSON body" },
            { status: 400 },
        )
    }

    const parsed = RequestSchema.safeParse(body)
    if (!parsed.success) {
        return NextResponse.json(
            { error: "Invalid request", details: parsed.error.issues },
            { status: 400 },
        )
    }

    const work = generateDiagram({
        ...parsed.data,
        abortSignal: req.signal,
    }).then(
        (result) => ({ body: result as unknown, status: 200 }),
        (error) => {
            console.error("[agent/diagram] Error:", error)
            return {
                body: {
                    error:
                        error instanceof Error
                            ? error.message
                            : "Diagram generation failed",
                },
                status:
                    error instanceof DiagramGenerationError
                        ? error.status
                        : 500,
            }
        },
    )
    return jsonWithHeartbeat(work)
}
