import { NextResponse } from "next/server"
import { z } from "zod"
import {
    checkAgentAccess,
    DiagramGenerationError,
    generateDiagram,
} from "@/lib/agent-diagram"

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

    try {
        const result = await generateDiagram({
            ...parsed.data,
            abortSignal: req.signal,
        })
        return NextResponse.json(result)
    } catch (error) {
        const status =
            error instanceof DiagramGenerationError ? error.status : 500
        console.error("[agent/diagram] Error:", error)
        return NextResponse.json(
            {
                error:
                    error instanceof Error
                        ? error.message
                        : "Diagram generation failed",
            },
            { status },
        )
    }
}
