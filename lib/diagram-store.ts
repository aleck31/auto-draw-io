import "@/lib/server-dom"
import { randomBytes } from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { sameDiagram } from "@/lib/diagram-fingerprint"

/**
 * Store for diagrams made through the agent and MCP endpoints, which the user
 * can also edit in the browser (/d/<id>).
 *
 * A diagram keeps its id while it changes. It has a current document and a
 * revision that every accepted write raises; conflicts are decided by the
 * revision alone. Its history is a list of versions that never change, the
 * last MAX_VERSIONS kept: every agent write adds one, while the browser's
 * saves only update the current document. Before an agent write replaces
 * browser edits, they are kept as a "user" version, so the history alternates
 * between the two instead of filling with autosaves. A diagram expires TTL
 * after its last change.
 *
 * With DIAGRAM_STORE_DIR set, each diagram is one JSON file in that directory,
 * so diagrams survive restarts and deploys; the directory may be shared by the
 * pods of a rolling update, so every write holds a per-diagram lock file.
 * Without it they are kept in memory and are lost on restart. Callers treat a
 * missing id as expired.
 */

const TTL_MS = 30 * 24 * 60 * 60 * 1000
const MAX_VERSIONS = 20
/** Memory only: the oldest diagrams are dropped beyond this */
const MAX_MEMORY_DIAGRAMS = 500
const SWEEP_INTERVAL_MS = 60 * 60 * 1000
/** A lock older than this was left by a process that died */
const STALE_LOCK_MS = 15_000
const LOCK_WAIT_MS = 5_000

export type VersionSource = "agent" | "user" | "restore"

export interface DiagramVersion {
    version: number
    xml: string
    createdAt: number
    source: VersionSource
}

export interface StoredDiagram {
    id: string
    createdAt: number
    updatedAt: number
    /** Raised by every accepted write */
    revision: number
    /** The current document */
    xml: string
    /** Who wrote the current document */
    source: VersionSource
    /** Oldest first; never changed once added */
    versions: DiagramVersion[]
}

/** The current document of a diagram */
export interface CurrentDiagram {
    xml: string
    revision: number
    source: VersionSource
    /** The version it is, or null when it has browser edits not in the history */
    version: number | null
}

interface Backend {
    read(id: string): StoredDiagram | null
    write(diagram: StoredDiagram): void
    remove(id: string): void
    sweep(now: number): void
    /** Runs fn with no other write to this diagram in between */
    exclusive<T>(id: string, fn: () => T): T
}

/** Ids are 128-bit random tokens; anything else is never a stored diagram */
const ID_PATTERN = /^[A-Za-z0-9_-]{22}$/

export function isDiagramId(id: string): boolean {
    return ID_PATTERN.test(id)
}

function isExpired(diagram: StoredDiagram, now = Date.now()): boolean {
    return now - diagram.updatedAt > TTL_MS
}

function memoryBackend(): Backend {
    // Map keeps insertion order; write() re-inserts, so the first is the stalest
    const diagrams = new Map<string, StoredDiagram>()
    return {
        read: (id) => diagrams.get(id) ?? null,
        write(diagram) {
            diagrams.delete(diagram.id)
            diagrams.set(diagram.id, diagram)
            while (diagrams.size > MAX_MEMORY_DIAGRAMS) {
                const stalest = diagrams.keys().next().value
                if (stalest === undefined) break
                diagrams.delete(stalest)
            }
        },
        remove: (id) => void diagrams.delete(id),
        sweep(now) {
            for (const [id, diagram] of diagrams) {
                if (isExpired(diagram, now)) diagrams.delete(id)
            }
        },
        // The store is synchronous, so nothing in this process runs in between
        exclusive: (_id, fn) => fn(),
    }
}

const pause = (ms: number) =>
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)

function fileBackend(dir: string): Backend {
    fs.mkdirSync(dir, { recursive: true })
    const file = (id: string) => path.join(dir, `${id}.json`)
    return {
        read(id) {
            try {
                return JSON.parse(
                    fs.readFileSync(file(id), "utf8"),
                ) as StoredDiagram
            } catch {
                return null
            }
        },
        write(diagram) {
            // Written aside and renamed, so a reader never sees half a file
            const tmp = `${file(diagram.id)}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`
            fs.writeFileSync(tmp, JSON.stringify(diagram))
            fs.renameSync(tmp, file(diagram.id))
        },
        remove: (id) => fs.rmSync(file(id), { force: true }),
        sweep(now) {
            for (const name of fs.readdirSync(dir)) {
                const full = path.join(dir, name)
                try {
                    // The file is rewritten on every change, so mtime is updatedAt
                    if (now - fs.statSync(full).mtimeMs > TTL_MS) {
                        fs.rmSync(full, { force: true })
                    }
                } catch {
                    // Removed by another pod meanwhile
                }
            }
        },
        exclusive(id, fn) {
            // Exclusive create is atomic on local disks and on EFS (NFSv4)
            const lock = path.join(dir, `${id}.lock`)
            const deadline = Date.now() + LOCK_WAIT_MS
            for (;;) {
                try {
                    fs.closeSync(fs.openSync(lock, "wx"))
                    break
                } catch (error) {
                    if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
                        throw error
                    }
                }
                try {
                    if (
                        Date.now() - fs.statSync(lock).mtimeMs >
                        STALE_LOCK_MS
                    ) {
                        fs.rmSync(lock, { force: true })
                        continue
                    }
                } catch {
                    continue // Released meanwhile
                }
                if (Date.now() > deadline) {
                    throw new Error("The diagram is busy; try again.")
                }
                pause(10)
            }
            try {
                return fn()
            } finally {
                fs.rmSync(lock, { force: true })
            }
        },
    }
}

let backend: Backend | null = null
let lastSweep = 0

function store(): Backend {
    if (!backend) {
        const dir = process.env.DIAGRAM_STORE_DIR?.trim()
        backend = dir ? fileBackend(dir) : memoryBackend()
    }
    const now = Date.now()
    if (now - lastSweep > SWEEP_INTERVAL_MS) {
        lastSweep = now
        try {
            backend.sweep(now)
        } catch (error) {
            console.error("[diagram-store] sweep failed:", error)
        }
    }
    return backend
}

function read(id: string): StoredDiagram | null {
    if (!isDiagramId(id)) return null
    const diagram = store().read(id)
    if (!diagram || isExpired(diagram)) return null
    return diagram
}

function currentOf(diagram: StoredDiagram): CurrentDiagram {
    const last = diagram.versions.at(-1)
    return {
        xml: diagram.xml,
        revision: diagram.revision,
        source: diagram.source,
        version: last && last.xml === diagram.xml ? last.version : null,
    }
}

/** The stored diagram, or null when the id is unknown or expired */
export function getStoredDiagram(id: string): StoredDiagram | null {
    return read(id)
}

/** The current document of a diagram, or null when unknown or expired */
export function getCurrentDiagram(id: string): CurrentDiagram | null {
    const diagram = read(id)
    return diagram ? currentOf(diagram) : null
}

/** A version from the history, or null when it is not kept */
export function getDiagramVersion(
    id: string,
    version: number,
): DiagramVersion | null {
    return read(id)?.versions.find((v) => v.version === version) ?? null
}

/** The current document, or a version from the history when version is given */
export function getDiagramAt(
    id: string,
    version?: number,
): { xml: string; version: number | null } | null {
    if (version === undefined) return getCurrentDiagram(id)
    return getDiagramVersion(id, version)
}

/** The current XML of a diagram, or null when unknown or expired */
export function getDiagram(id: string): string | null {
    return read(id)?.xml ?? null
}

/** Store a new diagram as version 1, revision 1 */
export function createDiagram(
    xml: string,
    source: VersionSource = "agent",
): { id: string; version: number; revision: number } {
    const id = randomBytes(16).toString("base64url")
    const now = Date.now()
    store().write({
        id,
        createdAt: now,
        updatedAt: now,
        revision: 1,
        xml,
        source,
        versions: [{ version: 1, xml, createdAt: now, source }],
    })
    return { id, version: 1, revision: 1 }
}

export type WriteResult =
    | { ok: true; version: number; revision: number; keptUserVersion?: number }
    | { ok: false; reason: "not-found" }
    | { ok: false; reason: "stale"; current: CurrentDiagram }

/**
 * An agent's write (or a restore): the next version. With baseRevision, it is
 * refused when the diagram changed since that revision. Browser edits it
 * replaces are kept as a "user" version first.
 */
export function writeDiagramVersion(
    id: string,
    xml: string,
    source: Exclude<VersionSource, "user">,
    baseRevision?: number,
): WriteResult {
    if (!isDiagramId(id)) return { ok: false, reason: "not-found" }
    return store().exclusive(id, () => {
        const diagram = read(id)
        if (!diagram) return { ok: false, reason: "not-found" }
        if (baseRevision !== undefined && baseRevision !== diagram.revision) {
            return { ok: false, reason: "stale", current: currentOf(diagram) }
        }
        const now = Date.now()
        const versions = [...diagram.versions]
        const last = versions.at(-1)
        let next = (last?.version ?? 0) + 1
        let keptUserVersion: number | undefined
        if (!last || !sameDiagram(last.xml, diagram.xml)) {
            keptUserVersion = next
            versions.push({
                version: next++,
                xml: diagram.xml,
                createdAt: diagram.updatedAt,
                source: "user",
            })
        }
        versions.push({ version: next, xml, createdAt: now, source })
        const revision = diagram.revision + 1
        store().write({
            ...diagram,
            updatedAt: now,
            revision,
            xml,
            source,
            versions: versions.slice(-MAX_VERSIONS),
        })
        return {
            ok: true,
            version: next,
            revision,
            ...(keptUserVersion && { keptUserVersion }),
        }
    })
}

export type UserSaveResult =
    | { ok: true; revision: number; unchanged: boolean }
    | { ok: false; reason: "not-found" }
    | { ok: false; reason: "stale"; current: CurrentDiagram }

/**
 * A save from the browser, based on baseRevision: it replaces the current
 * document without adding a version. Refused when the diagram changed since,
 * unless it is the same diagram (a retried save). A save of the same diagram
 * changes nothing, so draw.io's rewriting of a document is never an edit.
 */
export function saveUserEdit(
    id: string,
    xml: string,
    baseRevision: number,
): UserSaveResult {
    if (!isDiagramId(id)) return { ok: false, reason: "not-found" }
    return store().exclusive(id, () => {
        const diagram = read(id)
        if (!diagram) return { ok: false, reason: "not-found" }
        if (sameDiagram(xml, diagram.xml)) {
            return { ok: true, revision: diagram.revision, unchanged: true }
        }
        if (baseRevision !== diagram.revision) {
            return { ok: false, reason: "stale", current: currentOf(diagram) }
        }
        const revision = diagram.revision + 1
        store().write({
            ...diagram,
            updatedAt: Date.now(),
            revision,
            xml,
            source: "user",
        })
        return { ok: true, revision, unchanged: false }
    })
}
