import { generateText, isStepCount, tool } from "ai"
import { z } from "zod"
import {
    getAIModel,
    getServerModels,
    supportsTemperature,
} from "@/lib/ai-providers"
import { buildDiagramViewUrl } from "@/lib/diagram-link"
import { getSystemPrompt } from "@/lib/system-prompts"
import { getShapeLibraryTool } from "@/lib/tools"
import { validateAndFixXml, wrapWithMxFile } from "@/lib/utils"

/**
 * Headless diagram generation shared by the agent REST endpoint
 * (/api/agent/diagram) and the MCP endpoint (/api/mcp).
 *
 * Reuses the same model selection, system prompt, shape-library tool and XML
 * validation as the web client, but returns a plain result instead of a stream.
 */

export interface GenerateDiagramParams {
    prompt: string
    currentXml?: string
    modelId?: string
    abortSignal?: AbortSignal
    /**
     * Called with human-readable progress as generation proceeds. Long diagrams
     * can take minutes; callers use this to keep the connection alive (e.g. MCP
     * progress notifications) so proxies don't time the request out.
     */
    onProgress?: (message: string) => void
}

export interface GenerateDiagramResult {
    xml: string
    mxfile: string
    notes?: string[]
    /** Link that opens this diagram rendered in the app (needs APP_BASE_URL). */
    viewUrl?: string
}

export class DiagramGenerationError extends Error {
    status: number
    constructor(message: string, status = 500) {
        super(message)
        this.name = "DiagramGenerationError"
        this.status = status
    }
}

export async function generateDiagram({
    prompt,
    currentXml,
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

    let capturedXml: string | null = null

    const { model, providerOptions, headers, modelId } = getAIModel(overrides)

    onProgress?.(`Generating diagram with ${modelId}`)

    const result = await generateText({
        model,
        instructions: getSystemPrompt(modelId, false),
        maxOutputTokens: process.env.MAX_OUTPUT_TOKENS
            ? parseInt(process.env.MAX_OUTPUT_TOKENS, 10)
            : 32000,
        stopWhen: isStepCount(5),
        ...(abortSignal && { abortSignal }),
        onStepEnd: () => {
            onProgress?.("Still working on the diagram")
        },
        ...(process.env.TEMPERATURE !== undefined &&
            supportsTemperature(modelId) && {
                temperature: parseFloat(process.env.TEMPERATURE),
            }),
        ...(providerOptions && { providerOptions }),
        ...(headers && { headers }),
        messages: [
            {
                role: "user",
                content: currentXml
                    ? `Current diagram XML:\n"""xml\n${currentXml}\n"""\n\n${prompt}`
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

    // Validate/repair before handing XML to the caller.
    const mxfile = wrapWithMxFile(capturedXml)
    const validation = validateAndFixXml(mxfile)
    if (!validation.valid && !validation.fixed) {
        throw new DiagramGenerationError(
            `Generated XML is invalid: ${validation.error}`,
            502,
        )
    }

    const finalMxfile = validation.fixed || mxfile
    const viewUrl = buildDiagramViewUrl(finalMxfile)

    return {
        xml: capturedXml,
        mxfile: finalMxfile,
        ...(validation.fixes?.length && { notes: validation.fixes }),
        ...(viewUrl && { viewUrl }),
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
