import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock"
import { createAnthropic } from "@ai-sdk/anthropic"
import { createGoogleGenerativeAI } from "@ai-sdk/google"
import { createOpenAI } from "@ai-sdk/openai"
import { createOpenRouter } from "@openrouter/ai-sdk-provider"
import { generateText } from "ai"
import { NextResponse } from "next/server"
import { isPrivateUrl } from "@/lib/ssrf-protection"

export const runtime = "nodejs"

interface ValidateRequest {
    provider: string
    apiKey: string
    baseUrl?: string
    modelId: string
    // AWS Bedrock specific
    bedrockApiKey?: string
    awsAccessKeyId?: string
    awsSecretAccessKey?: string
    awsRegion?: string
}

export async function POST(req: Request) {
    try {
        const body: ValidateRequest = await req.json()
        const {
            provider,
            apiKey,
            baseUrl,
            modelId,
            bedrockApiKey,
            awsAccessKeyId,
            awsSecretAccessKey,
            awsRegion,
        } = body

        if (!provider || !modelId) {
            return NextResponse.json(
                { valid: false, error: "Provider and model ID are required" },
                { status: 400 },
            )
        }

        // SECURITY: Block SSRF attacks via custom baseUrl
        if (baseUrl && (await isPrivateUrl(baseUrl))) {
            return NextResponse.json(
                { valid: false, error: "Invalid base URL" },
                { status: 400 },
            )
        }

        // Validate credentials based on provider
        if (provider === "bedrock") {
            if (
                !bedrockApiKey &&
                (!awsAccessKeyId || !awsSecretAccessKey || !awsRegion)
            ) {
                return NextResponse.json(
                    {
                        valid: false,
                        error: "AWS Bearer Token or credentials (Access Key ID, Secret Access Key, Region) are required",
                    },
                    { status: 400 },
                )
            }
        } else if (!apiKey) {
            return NextResponse.json(
                { valid: false, error: "API key is required" },
                { status: 400 },
            )
        }

        let model: any

        switch (provider) {
            case "openai": {
                const openai = createOpenAI({
                    apiKey,
                    ...(baseUrl && { baseURL: baseUrl }),
                })
                model = openai.chat(modelId)
                break
            }

            case "anthropic": {
                const anthropic = createAnthropic({
                    apiKey,
                    baseURL: baseUrl || "https://api.anthropic.com/v1",
                })
                model = anthropic(modelId)
                break
            }

            case "google": {
                const google = createGoogleGenerativeAI({
                    apiKey,
                    ...(baseUrl && { baseURL: baseUrl }),
                })
                model = google(modelId)
                break
            }

            case "bedrock": {
                const bedrock = bedrockApiKey
                    ? createAmazonBedrock({
                          apiKey: bedrockApiKey,
                          region: awsRegion || "us-east-1",
                      })
                    : createAmazonBedrock({
                          accessKeyId: awsAccessKeyId,
                          secretAccessKey: awsSecretAccessKey,
                          region: awsRegion,
                      })
                model = bedrock(modelId)
                break
            }

            case "openrouter": {
                const openrouter = createOpenRouter({
                    apiKey,
                    ...(baseUrl && { baseURL: baseUrl }),
                })
                model = openrouter(modelId)
                break
            }

            default:
                return NextResponse.json(
                    { valid: false, error: `Unknown provider: ${provider}` },
                    { status: 400 },
                )
        }

        // Make a minimal test request
        const startTime = Date.now()
        await generateText({
            model,
            prompt: "Say 'OK'",
            maxOutputTokens: 20,
        })
        const responseTime = Date.now() - startTime

        return NextResponse.json({
            valid: true,
            responseTime,
        })
    } catch (error) {
        console.error("[validate-model] Error:", error)

        let errorMessage = "Validation failed"
        if (error instanceof Error) {
            // Extract meaningful error message
            if (
                error.message.includes("401") ||
                error.message.includes("Unauthorized")
            ) {
                errorMessage = "Invalid API key"
            } else if (
                error.message.includes("404") ||
                error.message.includes("not found")
            ) {
                errorMessage = "Model not found"
            } else if (
                error.message.includes("429") ||
                error.message.includes("rate limit")
            ) {
                errorMessage = "Rate limited - try again later"
            } else if (error.message.includes("ECONNREFUSED")) {
                errorMessage = "Cannot connect to server"
            } else {
                errorMessage = error.message.slice(0, 100)
            }
        }

        return NextResponse.json(
            { valid: false, error: errorMessage },
            { status: 200 }, // Return 200 so client can read error message
        )
    }
}
