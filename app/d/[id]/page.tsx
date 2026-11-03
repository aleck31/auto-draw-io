"use client"

import { use, useCallback, useEffect, useRef, useState } from "react"
import { AppLogo } from "@/components/app-logo"
import { DrawioFrame, type DrawioFrameHandle } from "@/components/drawio-frame"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { type SyncStatus, useDiagramSync } from "@/hooks/use-diagram-sync"
import { useDictionary } from "@/hooks/use-dictionary"
import { canReplaceDiagram, commitDiagram } from "@/lib/drawio-bridge"
import { drawioEditorSrc } from "@/lib/drawio-source"

/**
 * An agent's diagram (lib/diagram-store.ts) in the editor: the user's edits are
 * saved back, so the agent reads them with get_diagram. Only the editor, apart
 * from the app's own canvas and its saved diagram.
 */
export default function SharedDiagramPage({
    params,
}: {
    params: Promise<{ id: string }>
}) {
    const { id } = use(params)
    const dict = useDictionary().sharedDiagram
    const frameRef = useRef<DrawioFrameHandle>(null)
    const loadedRef = useRef(false)
    const [prefs, setPrefs] = useState<{
        ui: "min" | "sketch"
        dark: boolean
    } | null>(null)

    // A newer document goes in as one undo step when the editor allows it
    const show = useCallback((xml: string) => {
        if (canReplaceDiagram(xml)) commitDiagram(xml)
        else frameRef.current?.load({ xml })
    }, [])

    const sync = useDiagramSync(id, show)

    useEffect(() => {
        const ui = localStorage.getItem("drawio-theme")
        const savedDark = localStorage.getItem("auto-draw-io-dark-mode")
        const dark =
            savedDark === null
                ? window.matchMedia("(prefers-color-scheme: dark)").matches
                : savedDark === "true"
        document.documentElement.classList.toggle("dark", dark)
        setPrefs({ ui: ui === "sketch" ? "sketch" : "min", dark })
    }, [])

    // The frame starts empty; the diagram goes in once both are ready
    const handleLoad = useCallback(() => {
        if (loadedRef.current || sync.initialXml === null) return
        loadedRef.current = true
        frameRef.current?.load({ xml: sync.initialXml })
    }, [sync.initialXml])

    const handleAutoSave = useCallback(
        ({ xml }: { xml?: string }) => {
            if (loadedRef.current && xml) sync.onEdit(xml)
        },
        [sync.onEdit],
    )

    if (sync.status === "missing") {
        return (
            <main className="flex h-dvh items-center justify-center p-8 text-sm text-muted-foreground">
                {dict.missing}
            </main>
        )
    }

    return (
        <main className="flex h-dvh flex-col bg-background">
            <header className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border/60 px-3 py-1.5 text-sm">
                <a
                    href="./.."
                    className="flex shrink-0 items-center gap-2 font-semibold"
                >
                    <AppLogo className="h-5 w-5" />
                    <span>{dict.title}</span>
                </a>
                <StatusText
                    status={sync.status}
                    revision={sync.revision}
                    dict={dict}
                />
                <SyncActions sync={sync} dict={dict} />
            </header>
            <div className="relative min-h-0 flex-1">
                {prefs && sync.initialXml !== null && (
                    <DrawioFrame
                        ref={frameRef}
                        src={drawioEditorSrc({
                            ui: prefs.ui,
                            dark: prefs.dark,
                        })}
                        onLoad={handleLoad}
                        onAutoSave={handleAutoSave}
                        onSave={sync.saveNow}
                    />
                )}
            </div>
        </main>
    )
}

type Dict = ReturnType<typeof useDictionary>["sharedDiagram"]

function StatusText({
    status,
    revision,
    dict,
}: {
    status: SyncStatus
    revision: number | null
    dict: Dict
}) {
    const text: Record<SyncStatus, string> = {
        loading: dict.loading,
        saved: dict.saved,
        unsaved: dict.unsaved,
        saving: dict.saving,
        offline: dict.offline,
        conflict: dict.conflict,
        "access-code": dict.accessCode,
        missing: dict.missing,
        invalid: dict.invalid,
    }
    const warn = ["offline", "conflict", "access-code", "invalid"].includes(
        status,
    )
    return (
        <span
            data-testid="sync-status"
            data-status={status}
            className={
                warn
                    ? "text-amber-600 dark:text-amber-400"
                    : "text-muted-foreground"
            }
        >
            {text[status]}
            {revision !== null && status === "saved" && (
                <span className="ml-1 opacity-70">
                    · {dict.revision} {revision}
                </span>
            )}
        </span>
    )
}

function SyncActions({
    sync,
    dict,
}: {
    sync: ReturnType<typeof useDiagramSync>
    dict: Dict
}) {
    const [code, setCode] = useState("")
    if (sync.status === "conflict") {
        return (
            <span className="flex gap-2">
                <Button size="sm" onClick={sync.loadLatest}>
                    {dict.loadLatest}
                </Button>
                <Button size="sm" variant="outline" onClick={sync.keepMine}>
                    {dict.keepMine}
                </Button>
            </span>
        )
    }
    if (sync.status === "access-code") {
        return (
            <form
                className="flex gap-2"
                onSubmit={(event) => {
                    event.preventDefault()
                    if (code.trim()) sync.setAccessCode(code.trim())
                }}
            >
                <Input
                    type="password"
                    value={code}
                    onChange={(event) => setCode(event.target.value)}
                    placeholder={dict.accessCodePlaceholder}
                    className="h-8 w-40"
                />
                <Button size="sm" type="submit">
                    OK
                </Button>
            </form>
        )
    }
    return null
}
