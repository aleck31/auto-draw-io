"use client"

import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "@/components/ui/tooltip"
import { useDictionary } from "@/hooks/use-dictionary"
import type { ReplyUsage } from "@/lib/reply-usage"

const exact = new Intl.NumberFormat("en")
// From 10,000 on, three significant digits: 12.2K
const compact = new Intl.NumberFormat("en", {
    notation: "compact",
    maximumSignificantDigits: 3,
})
const short = (tokens: number) =>
    (tokens < 10_000 ? exact : compact).format(tokens)

/**
 * An answer's input and output tokens and its time, after the buttons under
 * it; pointing at it shows the details. Adapted from next-ai-draw-io (#1016,
 * components/chat/reply-usage.tsx, Apache-2.0).
 */
export function ReplyUsageNote({ usage }: { usage: ReplyUsage }) {
    const t = useDictionary().chat
    const seconds = Math.max(1, Math.round(usage.durationMs / 1000))
    // The cache and thinking rows only where the provider reported them
    const rows = [
        { label: t.usageInput, tokens: usage.inputTokens },
        { label: t.usageCacheRead, tokens: usage.cacheReadTokens, part: true },
        { label: t.usageOutput, tokens: usage.outputTokens },
        { label: t.usageReasoning, tokens: usage.reasoningTokens, part: true },
    ].filter((row) => !row.part || row.tokens > 0)

    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <span
                    // Focusable, so the keyboard reaches the details too
                    tabIndex={0}
                    data-testid="reply-usage"
                    className="ml-1.5 cursor-default rounded text-[11px] tabular-nums text-muted-foreground/70 outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                    {t.usageSummary
                        .replace("{input}", short(usage.inputTokens))
                        .replace("{output}", short(usage.outputTokens))
                        .replace("{seconds}", String(seconds))}
                </span>
            </TooltipTrigger>
            <TooltipContent side="top" align="start">
                <dl className="grid grid-cols-[auto_auto_auto] gap-x-1.5 gap-y-1 text-xs">
                    {rows.map((row) => (
                        <div key={row.label} className="contents">
                            <dt className={row.part ? "pl-3 pr-3" : "pr-3"}>
                                {row.label}
                            </dt>
                            <dd className="text-right tabular-nums">
                                {exact.format(row.tokens)}
                            </dd>
                            <dd>{t.usageTokenUnit}</dd>
                        </div>
                    ))}
                    <div className="contents">
                        <dt className="pr-3">{t.usageTime}</dt>
                        <dd className="text-right tabular-nums">
                            {(usage.durationMs / 1000).toFixed(1)}
                        </dd>
                        <dd>s</dd>
                    </div>
                </dl>
            </TooltipContent>
        </Tooltip>
    )
}
