import { RotateCcw } from "lucide-react"
import { useDiagram } from "@/contexts/diagram-context"
import { useDictionary } from "@/hooks/use-dictionary"
import { formatMessage } from "@/lib/format-message"
import { type DiagramVersion, describeChange } from "@/lib/versions"

/** A version's picture, or what stands in for it */
export function VersionThumb({
    svg,
    className = "",
}: {
    /** undefined: still being made; "": none could be made */
    svg: string | undefined
    className?: string
}) {
    const t = useDictionary().versions
    if (svg) {
        return (
            // biome-ignore lint/performance/noImgElement: an SVG data URL from the canvas
            <img src={svg} alt="" className={`object-contain ${className}`} />
        )
    }
    return (
        <span className="text-[11px] text-muted-foreground">
            {svg === "" ? t.noPreview : t.rendering}
        </span>
    )
}

/**
 * The version a tool call put on the canvas: picture, number, what changed,
 * and restore unless the canvas shows it. The picture opens the comparison.
 */
export function VersionCard({
    version,
    disabled,
}: {
    version: DiagramVersion
    /** An answer is running */
    disabled: boolean
}) {
    const t = useDictionary().versions
    const { onCanvasVersionId, restoreVersion, openCompare } = useDiagram()
    const isOnCanvas = onCanvasVersionId === version.id
    return (
        <div
            className="flex items-center gap-3 border-t border-border/40 px-4 py-2.5"
            data-testid="version-card"
        >
            <button
                type="button"
                onClick={() => openCompare(version.id)}
                className="flex h-12 w-20 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-white hover:border-primary/50"
                aria-label={t.compare}
                title={t.compare}
            >
                <VersionThumb
                    svg={version.svg}
                    className="max-h-11 max-w-[76px]"
                />
            </button>
            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                    <span
                        className={`shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-semibold tabular-nums ${isOnCanvas ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}
                    >
                        v{version.number}
                    </span>
                    <span className="truncate text-sm font-medium text-foreground/90">
                        {version.fromScratch ? t.drew : t.changed}
                    </span>
                </div>
                <div className="mt-0.5 truncate text-xs text-muted-foreground">
                    {describeChange(version)}
                </div>
                {isOnCanvas ? (
                    <div
                        className="mt-1 text-xs text-primary"
                        data-testid="version-on-canvas"
                    >
                        {t.onCanvas}
                    </div>
                ) : (
                    <button
                        type="button"
                        disabled={disabled}
                        onClick={() => restoreVersion(version.id)}
                        className="mt-0.5 -ml-1.5 inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
                        data-testid="version-restore"
                    >
                        <RotateCcw className="h-3 w-3" />
                        {formatMessage(t.restore, { n: version.number })}
                    </button>
                )}
            </div>
        </div>
    )
}
