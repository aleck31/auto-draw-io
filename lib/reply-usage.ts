import type { LanguageModelUsage } from "ai"

/**
 * Tokens and model time of an answer, over all the requests of its turn.
 * Adapted from next-ai-draw-io (#1016, lib/chat-message.ts, Apache-2.0).
 */
export interface ReplyUsage {
    inputTokens: number
    outputTokens: number
    /** Of the input, read from the provider's prompt cache */
    cacheReadTokens: number
    /** Of the output, spent thinking */
    reasoningTokens: number
    durationMs: number
}

/**
 * The answer's usage with one more request added. A turn's later requests
 * (after a tool result, a retry) continue the same assistant message, so
 * `before` is what that message already carries. A request whose provider
 * reported no usage adds nothing.
 */
export function addReplyUsage(
    before: ReplyUsage | undefined,
    usage: LanguageModelUsage | undefined,
    durationMs: number,
): ReplyUsage | undefined {
    if (usage?.inputTokens === undefined && usage?.outputTokens === undefined) {
        return before
    }
    return {
        inputTokens: (before?.inputTokens ?? 0) + (usage.inputTokens ?? 0),
        outputTokens: (before?.outputTokens ?? 0) + (usage.outputTokens ?? 0),
        cacheReadTokens:
            (before?.cacheReadTokens ?? 0) +
            (usage.inputTokenDetails?.cacheReadTokens ?? 0),
        reasoningTokens:
            (before?.reasoningTokens ?? 0) +
            (usage.outputTokenDetails?.reasoningTokens ?? 0),
        durationMs: (before?.durationMs ?? 0) + durationMs,
    }
}

/** The usage a message's metadata carries, if it is well formed */
export function replyUsageOf(metadata: unknown): ReplyUsage | undefined {
    const usage = (metadata as { usage?: ReplyUsage } | undefined)?.usage
    return usage &&
        Number.isFinite(usage.inputTokens) &&
        Number.isFinite(usage.outputTokens) &&
        Number.isFinite(usage.durationMs)
        ? usage
        : undefined
}
