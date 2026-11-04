import { useCallback, useEffect, useState, useSyncExternalStore } from "react"
import {
    getNoSelection,
    getSelection,
    subscribeSelection,
} from "@/lib/drawio-bridge"
import { type SelectedCell, selectionKey } from "@/lib/selection"

/**
 * The canvas selection that goes with the next chat message. The user can
 * take it off the message; selecting other cells, or the same ones again
 * after clearing the selection, attaches it again.
 */
export function useCanvasSelection(): {
    selection: SelectedCell[]
    dismiss: () => void
} {
    const selection = useSyncExternalStore(
        subscribeSelection,
        getSelection,
        getNoSelection,
    )
    const key = selectionKey(selection)
    const [dismissedKey, setDismissedKey] = useState("")
    useEffect(() => {
        if (!key) setDismissedKey("")
    }, [key])
    const dismiss = useCallback(() => setDismissedKey(key), [key])
    return {
        selection: key && key !== dismissedKey ? selection : getNoSelection(),
        dismiss,
    }
}
