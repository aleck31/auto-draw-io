import { SquareDashedMousePointer, X } from "lucide-react"
import { useDictionary } from "@/hooks/use-dictionary"
import { formatMessage } from "@/lib/format-message"
import type { SelectedCell } from "@/lib/selection"

/** The canvas selection a message carries: in the input, or on a sent message */
export function SelectionChip({
    cells,
    onRemove,
    className = "",
}: {
    cells: SelectedCell[]
    onRemove?: () => void
    className?: string
}) {
    const dict = useDictionary()
    if (cells.length === 0) return null
    const label =
        cells.length === 1
            ? formatMessage(dict.selection.one, {
                  label:
                      cells[0].label ||
                      (cells[0].isEdge
                          ? dict.selection.connector
                          : dict.selection.shape),
              })
            : formatMessage(dict.selection.many, { count: cells.length })
    return (
        <span
            className={`inline-flex max-w-full items-center gap-1.5 rounded-lg bg-primary/10 py-1 pl-2 text-xs font-medium text-primary ${onRemove ? "pr-1" : "pr-2"} ${className}`}
            data-testid="selection-chip"
        >
            <SquareDashedMousePointer className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{label}</span>
            {onRemove && (
                <button
                    type="button"
                    onClick={onRemove}
                    aria-label={dict.selection.remove}
                    title={dict.selection.remove}
                    className="rounded p-0.5 hover:bg-primary/10"
                >
                    <X className="h-3 w-3" />
                </button>
            )}
        </span>
    )
}
