import { generateObject } from "ai"
import { NextResponse } from "next/server"
import { z } from "zod"
import { getAIModel } from "@/lib/ai-providers"

export const maxDuration = 30

const ValidationSchema = z.object({
    valid: z.boolean().describe("true if no critical issues found"),
    issues: z
        .array(
            z.object({
                severity: z.enum(["critical", "warning"]),
                description: z.string(),
            }),
        )
        .describe("List of visual issues found"),
    suggestions: z
        .array(z.string())
        .describe("Actionable suggestions to fix issues"),
})

const SYSTEM_PROMPT = `You are a diagram quality validator. Analyze the rendered diagram image for visual issues.

Evaluate for:
1. **Overlapping elements** (critical): Shapes covering each other, making content unreadable
2. **Edge routing issues** (critical): Lines/arrows crossing through unrelated shapes
3. **Text readability** (warning): Labels cut off, overlapping, or too small
4. **Layout quality** (warning): Poor spacing, misalignment, or cramped elements
5. **Rendering errors** (critical): Incomplete, corrupted, or missing elements

Rules:
- Set "valid" to true ONLY if there are no critical issues
- Be specific about which elements have problems
- Provide actionable suggestions
- Minor cosmetic issues should be warnings, not critical
- Empty or simple diagrams (1-2 elements) should pass unless they have obvious errors
- If the diagram looks generally acceptable, set valid to true even with minor warnings`

export async function POST(req: Request) {
    try {
        const { imageData } = await req.json()

        if (!imageData) {
            return NextResponse.json(
                { error: "imageData is required" },
                { status: 400 },
            )
        }

        // Use the server's default model for validation
        const { model } = getAIModel()

        const { object } = await generateObject({
            model,
            schema: ValidationSchema,
            messages: [
                { role: "system", content: SYSTEM_PROMPT },
                {
                    role: "user",
                    content: [
                        {
                            type: "text",
                            text: "Validate this diagram for visual quality issues.",
                        },
                        { type: "image", image: imageData },
                    ],
                },
            ],
            abortSignal: AbortSignal.timeout(25000),
        })

        return NextResponse.json(object)
    } catch (error) {
        console.error("[validate-diagram] Error:", error)
        return NextResponse.json(
            { error: "Validation failed" },
            { status: 500 },
        )
    }
}
