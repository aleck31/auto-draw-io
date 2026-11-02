/**
 * Turns a model provider's error into a message the user can act on.
 *
 * Errors from a streamed answer reach the client only as text; the AI SDK
 * replaces them with "An error occurred." unless the route maps them. The
 * known causes get a fixed explanation; anything else is passed on only when
 * it can't contain a secret.
 *
 * The patterns are adapted from next-ai-draw-io (lib/llm-errors.ts, Apache-2.0).
 */
import { APICallError } from "ai"

export type LLMErrorCode =
    | "context_too_long"
    | "images_unsupported"
    | "tools_unsupported"
    | "output_truncated"
    | "output_limit"
    | "model_not_found"
    | "rate_limited"
    | "insufficient_quota"
    | "auth"
    | "unknown"

const MESSAGES: Record<Exclude<LLMErrorCode, "unknown">, string> = {
    context_too_long:
        "The conversation is too long for this model. Start a new chat, or pick a model with a larger context window.",
    images_unsupported:
        "This model doesn't support image input. Remove the image or pick another model.",
    tools_unsupported:
        "This model doesn't support tool calls, which drawing needs. Pick another model.",
    output_truncated:
        "The answer was cut off before the diagram was complete. Try a simpler request, or split it into steps.",
    output_limit:
        "The output limit is higher than this model allows. Lower MAX_OUTPUT_TOKENS on the server.",
    model_not_found:
        "The model isn't available. Check the model ID (Bedrock needs the inference profile ID, e.g. global.anthropic...) and that access to it is enabled.",
    rate_limited:
        "The model provider is limiting requests. Wait a moment and try again.",
    insufficient_quota:
        "The model provider account has no quota or credit left.",
    auth: "Authentication failed. Please check your API key or credentials.",
}

// Texts that name the cause more precisely than the status code: a quota
// error can come as 403 or 429, a context or image error as a plain 400
const SPECIFIC_TEXTS: Array<[RegExp, LLMErrorCode]> = [
    [
        // Not "too many tokens": that is Bedrock's throttling message
        /context length|context window|maximum context|prompt is too long|input is too long|too many input tokens/i,
        "context_too_long",
    ],
    [
        /image content block|image_url|does not support image|image input is not supported/i,
        "images_unsupported",
    ],
    [
        /does not support tools|tool use is not supported|tools? (?:are|is) not supported|function calling is not supported/i,
        "tools_unsupported",
    ],
    // Bedrock, when the output limit cut the tool call's JSON short
    [/toolUse\.input is invalid/i, "output_truncated"],
    [
        /maximum tokens you requested exceeds|max_tokens: \d+ > \d+|at most \d+ completion tokens/i,
        "output_limit",
    ],
    // Bedrock, for a model id without the inference profile prefix
    [
        /on-demand throughput isn.t supported|model identifier is invalid|model not found|does not exist|don't have access to the model/i,
        "model_not_found",
    ],
    [
        /insufficient[_ ]quota|insufficient balance|exceeded your current quota|credit balance is too low/i,
        "insufficient_quota",
    ],
    [/too many tokens|too many requests|rate limit|throttl/i, "rate_limited"],
    [
        /security token|invalid api key|incorrect api key|unauthorized|not authorized/i,
        "auth",
    ],
]

const STATUS_CODES: Record<number, LLMErrorCode> = {
    401: "auth",
    403: "auth",
    404: "model_not_found",
    413: "context_too_long",
    429: "rate_limited",
}

// Words that can mark a message carrying a secret
const SENSITIVE = /key|token|sig|secret|password|credential/i

function errorText(error: unknown): string {
    if (APICallError.isInstance(error)) {
        return `${error.message} ${error.responseBody ?? ""}`
    }
    if (error instanceof Error) {
        const cause = (error as { cause?: unknown }).cause
        return cause ? `${error.message} ${errorText(cause)}` : error.message
    }
    return typeof error === "string" ? error : ""
}

function statusOf(error: unknown): number | undefined {
    if (APICallError.isInstance(error)) return error.statusCode
    const e = error as { statusCode?: unknown; status?: unknown } | undefined
    const status = e?.statusCode ?? e?.status
    return typeof status === "number" ? status : undefined
}

export function classifyLLMError(error: unknown): {
    code: LLMErrorCode
    message: string
} {
    const text = errorText(error)
    const code =
        SPECIFIC_TEXTS.find(([pattern]) => pattern.test(text))?.[1] ??
        STATUS_CODES[statusOf(error) ?? 0] ??
        "unknown"
    if (code !== "unknown") return { code, message: MESSAGES[code] }
    const raw = error instanceof Error ? error.message : text
    return {
        code,
        message:
            raw && !SENSITIVE.test(raw)
                ? raw.slice(0, 300)
                : "The model request failed. Please try again.",
    }
}
