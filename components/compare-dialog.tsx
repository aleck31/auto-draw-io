import { ChevronLeft, ChevronRight, RotateCcw } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { VersionThumb } from "@/components/version-card"
import { useDiagram } from "@/contexts/diagram-context"
import { useDictionary } from "@/hooks/use-dictionary"
import { cellLabels, diffPageModels } from "@/lib/diagram-diff"
import { pageModelXml } from "@/lib/diagram-pages"
import { formatMessage } from "@/lib/format-message"
import { describeSummary } from "@/lib/versions"

// Changed shapes named in the description; more are counted
const MAX_NAMES = 5

const lowerFirst = (text: string) =>
    text.charAt(0).toLowerCase() + text.slice(1)

type Focus = "version" | "canvas" | null

/** One picture; a click shows it alone, at the size of both, and back */
function Sheet({
    label,
    svg,
    focused,
    onToggle,
    hint,
}: {
    label: string
    svg: string | undefined
    focused: boolean
    onToggle: () => void
    hint: string
}) {
    return (
        <figure className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
            <figcaption className="text-xs font-medium text-muted-foreground">
                {label}
            </figcaption>
            <button
                type="button"
                onClick={onToggle}
                title={hint}
                className={`flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-xl border border-border bg-white p-2 hover:border-primary/40 ${focused ? "cursor-zoom-out" : "cursor-zoom-in"}`}
            >
                <VersionThumb svg={svg} className="h-full w-full" />
            </button>
        </figure>
    )
}

/** A version next to the canvas as it is now, with restore */
export function CompareDialog({ disabled }: { disabled: boolean }) {
    const t = useDictionary().versions
    const {
        versions,
        compareVersionId,
        openCompare,
        onCanvasVersionId,
        restoreVersion,
        chartXML,
        captureSvg,
    } = useDiagram()
    const [canvasSvg, setCanvasSvg] = useState<string | undefined>(undefined)
    const [focus, setFocus] = useState<Focus>(null)
    const toggle = (side: Exclude<Focus, null>) =>
        setFocus((now) => (now === side ? null : side))

    const index = versions.findIndex((v) => v.id === compareVersionId)
    const version = index >= 0 ? versions[index] : null
    const isOnCanvas = !!version && onCanvasVersionId === version.id

    // What the canvas changed since this version, on the page it was made on
    const changes = useMemo(() => {
        if (!version || isOnCanvas) return null
        const canvasModel = pageModelXml(chartXML, version.pageId)
        const { summary, touchedIds } = diffPageModels(
            pageModelXml(version.xml, version.pageId),
            canvasModel,
        )
        if (!Object.values(summary).some((n) => n > 0)) return null
        return { summary, names: cellLabels(canvasModel, touchedIds) }
    }, [version, isOnCanvas, chartXML])
    const names = changes?.names.slice(0, MAX_NAMES) ?? []
    const moreNames = (changes?.names.length ?? 0) - names.length

    // The version went away (a new chat): nothing to show
    useEffect(() => {
        if (compareVersionId && !version) openCompare(null)
    }, [compareVersionId, version, openCompare])

    // Opens on both pictures
    useEffect(() => {
        if (!compareVersionId) setFocus(null)
    }, [compareVersionId])

    // The canvas now; again once a running answer is done (captureSvg reads refs only)
    useEffect(() => {
        if (!compareVersionId) return
        let cancelled = false
        setCanvasSvg(undefined)
        captureSvg().then((svg) => {
            if (!cancelled) setCanvasSvg(svg)
        })
        return () => {
            cancelled = true
        }
    }, [compareVersionId, disabled])

    const description = !version
        ? ""
        : isOnCanvas
          ? t.isOnCanvas
          : changes
            ? formatMessage(t.since, {
                  n: version.number,
                  changes: lowerFirst(describeSummary(changes.summary)),
              })
            : formatMessage(t.differsElsewhere, { n: version.number })

    const navButton =
        "inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border text-muted-foreground hover:text-foreground disabled:opacity-30"
    return (
        <Dialog
            open={!!version}
            onOpenChange={(open) => !open && openCompare(null)}
        >
            {/* Nearly the whole window: diagrams are only readable large */}
            <DialogContent
                className="flex h-[calc(100dvh-2rem)] flex-col sm:max-w-[min(1800px,calc(100vw-2rem))]"
                data-testid="compare-dialog"
            >
                <DialogHeader>
                    <DialogTitle>{t.compareTitle}</DialogTitle>
                    <DialogDescription>{description}</DialogDescription>
                    {names.length > 0 && (
                        <p className="text-sm text-muted-foreground">
                            {formatMessage(
                                moreNames > 0
                                    ? t.changedNamesMore
                                    : t.changedNames,
                                { names: names.join(", "), n: moreNames },
                            )}
                        </p>
                    )}
                </DialogHeader>
                {version && (
                    <div className="flex min-h-0 flex-1 flex-col gap-4 sm:flex-row">
                        {focus !== "canvas" && (
                            <Sheet
                                label={formatMessage(t.versionLabel, {
                                    n: version.number,
                                })}
                                svg={version.svg}
                                focused={focus === "version"}
                                onToggle={() => toggle("version")}
                                hint={focus ? t.showBoth : t.enlarge}
                            />
                        )}
                        {focus !== "version" && (
                            <Sheet
                                label={t.canvasNow}
                                svg={canvasSvg}
                                focused={focus === "canvas"}
                                onToggle={() => toggle("canvas")}
                                hint={focus ? t.showBoth : t.enlarge}
                            />
                        )}
                    </div>
                )}
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        disabled={index <= 0}
                        onClick={() => openCompare(versions[index - 1].id)}
                        className={navButton}
                        aria-label={t.previous}
                        title={t.previous}
                    >
                        <ChevronLeft className="h-4 w-4" />
                    </button>
                    <button
                        type="button"
                        disabled={index < 0 || index >= versions.length - 1}
                        onClick={() => openCompare(versions[index + 1].id)}
                        className={navButton}
                        aria-label={t.next}
                        title={t.next}
                    >
                        <ChevronRight className="h-4 w-4" />
                    </button>
                    <span className="text-xs tabular-nums text-muted-foreground">
                        {index + 1} / {versions.length}
                    </span>
                    <button
                        type="button"
                        disabled={!version || isOnCanvas || disabled}
                        onClick={() => {
                            if (!version) return
                            restoreVersion(version.id)
                            openCompare(null)
                        }}
                        className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-40"
                        data-testid="compare-restore"
                    >
                        <RotateCcw className="h-4 w-4" />
                        {formatMessage(t.restore, { n: version?.number ?? 0 })}
                    </button>
                </div>
            </DialogContent>
        </Dialog>
    )
}
