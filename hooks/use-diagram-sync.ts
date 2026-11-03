"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { getApiEndpoint } from "@/lib/base-path"
import { STORAGE_KEYS } from "@/lib/storage"

/**
 * Keeps a stored agent diagram (/d/<id>) and the editor showing it in step.
 *
 * Edits are saved 2 s after draw.io's last autosave, as the whole document
 * with the revision they are based on; one save is in flight at a time. The
 * server refuses a save when the diagram changed since (409): the user then
 * loads the latest or keeps their version. Unsaved edits stay in
 * sessionStorage, so a reload does not lose them. When the page comes back to
 * the front, a newer diagram is loaded if there are no unsaved edits.
 */

const SAVE_DELAY_MS = 2_000
const RETRY_DELAY_MS = 5_000

export type SyncStatus =
    | "loading"
    | "saved"
    | "unsaved"
    | "saving"
    | "offline"
    | "conflict"
    | "access-code"
    | "missing"
    | "invalid"

interface Remote {
    mxfile: string
    revision: number
}

interface Draft {
    xml: string
    baseRevision: number
}

const draftKey = (id: string) => `auto-draw-io-shared-draft-${id}`

function readDraft(id: string): Draft | null {
    try {
        const draft = JSON.parse(sessionStorage.getItem(draftKey(id)) || "null")
        return typeof draft?.xml === "string" &&
            Number.isInteger(draft.baseRevision)
            ? draft
            : null
    } catch {
        return null
    }
}

export function useDiagramSync(
    id: string,
    /** Shows a document in the editor (in place when possible) */
    show: (xml: string) => void,
) {
    const [status, setStatus] = useState<SyncStatus>("loading")
    const [revision, setRevision] = useState<number | null>(null)
    const [initialXml, setInitialXml] = useState<string | null>(null)
    const revisionRef = useRef(0)
    const pendingRef = useRef<string | null>(null)
    const inFlightRef = useRef(false)
    const conflictRef = useRef<Remote | null>(null)
    const statusRef = useRef<SyncStatus>("loading")
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const showRef = useRef(show)
    showRef.current = show

    const setBoth = useCallback((next: SyncStatus) => {
        statusRef.current = next
        setStatus(next)
    }, [])

    const setRev = useCallback((next: number) => {
        revisionRef.current = next
        setRevision(next)
    }, [])

    const keepDraft = useCallback(() => {
        const xml = pendingRef.current
        if (xml === null) sessionStorage.removeItem(draftKey(id))
        else {
            sessionStorage.setItem(
                draftKey(id),
                JSON.stringify({ xml, baseRevision: revisionRef.current }),
            )
        }
    }, [id])

    const fetchRemote = useCallback(async (): Promise<Remote | null> => {
        const res = await fetch(getApiEndpoint(`/api/diagram/${id}`), {
            cache: "no-store",
        })
        if (res.status === 404) {
            setBoth("missing")
            return null
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json()
    }, [id, setBoth])

    const flushRef = useRef<() => void>(() => {})

    const schedule = useCallback((delay = SAVE_DELAY_MS) => {
        if (timerRef.current) clearTimeout(timerRef.current)
        timerRef.current = setTimeout(() => flushRef.current(), delay)
    }, [])

    const flush = useCallback(async () => {
        const xml = pendingRef.current
        const blocked = ["conflict", "access-code", "missing"]
        if (xml === null || inFlightRef.current) return
        if (blocked.includes(statusRef.current)) return
        inFlightRef.current = true
        setBoth("saving")
        try {
            const res = await fetch(getApiEndpoint(`/api/diagram/${id}`), {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json",
                    "x-access-code":
                        localStorage.getItem(STORAGE_KEYS.accessCode) || "",
                },
                body: JSON.stringify({
                    xml,
                    baseRevision: revisionRef.current,
                }),
            })
            const data = await res.json().catch(() => ({}))
            if (res.ok) {
                setRev(data.revision)
                if (pendingRef.current === xml) pendingRef.current = null
                keepDraft()
                setBoth(pendingRef.current === null ? "saved" : "unsaved")
                if (pendingRef.current !== null) schedule()
            } else if (res.status === 409) {
                conflictRef.current = {
                    mxfile: data.mxfile,
                    revision: data.revision,
                }
                setBoth("conflict")
            } else if (res.status === 401) {
                setBoth("access-code")
            } else if (res.status === 404) {
                setBoth("missing")
            } else if (res.status === 400 || res.status === 413) {
                setBoth("invalid")
            } else {
                throw new Error(`HTTP ${res.status}`)
            }
        } catch {
            // A retried save of the same document is harmless: the server
            // takes a diagram it already has as unchanged
            setBoth("offline")
            schedule(RETRY_DELAY_MS)
        } finally {
            inFlightRef.current = false
        }
    }, [id, keepDraft, schedule, setBoth, setRev])
    flushRef.current = flush

    // First load, with the unsaved edits of an earlier visit if there are any
    useEffect(() => {
        let cancelled = false
        fetchRemote()
            .then((remote) => {
                if (cancelled || !remote) return
                const draft = readDraft(id)
                setRev(draft ? draft.baseRevision : remote.revision)
                setInitialXml(draft ? draft.xml : remote.mxfile)
                if (!draft) {
                    setBoth("saved")
                    return
                }
                pendingRef.current = draft.xml
                if (draft.baseRevision === remote.revision) {
                    setBoth("unsaved")
                    schedule()
                } else {
                    conflictRef.current = remote
                    setBoth("conflict")
                }
            })
            .catch(() => !cancelled && setBoth("offline"))
        return () => {
            cancelled = true
        }
    }, [fetchRemote, id, schedule, setBoth, setRev])

    /** draw.io's autosave: the user changed the diagram */
    const onEdit = useCallback(
        (xml: string) => {
            if (statusRef.current === "loading") return
            pendingRef.current = xml
            keepDraft()
            if (
                statusRef.current === "saved" ||
                statusRef.current === "offline"
            ) {
                setBoth("unsaved")
            }
            schedule()
        },
        [keepDraft, schedule, setBoth],
    )

    const loadLatest = useCallback(() => {
        const remote = conflictRef.current
        if (!remote) return
        conflictRef.current = null
        pendingRef.current = null
        setRev(remote.revision)
        keepDraft()
        setBoth("saved")
        showRef.current(remote.mxfile)
    }, [keepDraft, setBoth, setRev])

    const keepMine = useCallback(() => {
        const remote = conflictRef.current
        if (!remote) return
        conflictRef.current = null
        setRev(remote.revision)
        keepDraft()
        setBoth("unsaved")
        void flushRef.current()
    }, [keepDraft, setBoth, setRev])

    const setAccessCode = useCallback(
        (code: string) => {
            localStorage.setItem(STORAGE_KEYS.accessCode, code)
            setBoth("unsaved")
            void flushRef.current()
        },
        [setBoth],
    )

    // Back in front: show what the agent drew meanwhile
    useEffect(() => {
        const onVisible = async () => {
            if (document.visibilityState !== "visible") return
            if (statusRef.current !== "saved" || inFlightRef.current) return
            try {
                const remote = await fetchRemote()
                if (
                    remote &&
                    remote.revision > revisionRef.current &&
                    statusRef.current === "saved" &&
                    pendingRef.current === null
                ) {
                    setRev(remote.revision)
                    showRef.current(remote.mxfile)
                }
            } catch {
                // The next save or visit tries again
            }
        }
        document.addEventListener("visibilitychange", onVisible)
        window.addEventListener("focus", onVisible)
        return () => {
            document.removeEventListener("visibilitychange", onVisible)
            window.removeEventListener("focus", onVisible)
        }
    }, [fetchRemote, setRev])

    // Unsaved edits: ask before leaving
    useEffect(() => {
        const onBeforeUnload = (event: BeforeUnloadEvent) => {
            if (pendingRef.current !== null || inFlightRef.current) {
                event.preventDefault()
            }
        }
        window.addEventListener("beforeunload", onBeforeUnload)
        return () => {
            window.removeEventListener("beforeunload", onBeforeUnload)
            if (timerRef.current) clearTimeout(timerRef.current)
        }
    }, [])

    /** draw.io's Save button: save now instead of after the pause */
    const saveNow = useCallback(() => {
        if (timerRef.current) clearTimeout(timerRef.current)
        void flushRef.current()
    }, [])

    return {
        status,
        revision,
        initialXml,
        onEdit,
        saveNow,
        loadLatest,
        keepMine,
        setAccessCode,
    }
}
