import { randomBytes } from "node:crypto"
import fs from "node:fs"
import path from "node:path"

/**
 * Store for diagrams made through the agent and MCP endpoints.
 *
 * A diagram keeps its id while it changes: every change adds a version, and
 * the last MAX_VERSIONS are kept. A diagram expires TTL after its last change.
 *
 * With DIAGRAM_STORE_DIR set, each diagram is one JSON file in that directory,
 * so diagrams survive restarts and deploys (the directory may be shared by the
 * pods of a rolling update). Without it they are kept in memory and are lost on
 * restart. Callers treat a missing id as expired.
 */

const TTL_MS = 30 * 24 * 60 * 60 * 1000
const MAX_VERSIONS = 20
/** Memory only: the oldest diagrams are dropped beyond this */
const MAX_MEMORY_DIAGRAMS = 500
const SWEEP_INTERVAL_MS = 60 * 60 * 1000

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
    /** Oldest first; the last one is the current diagram */
    versions: DiagramVersion[]
}

interface Backend {
    read(id: string): StoredDiagram | null
    write(diagram: StoredDiagram): void
    remove(id: string): void
    sweep(now: number): void
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
    }
}

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

/** The stored diagram, or null when the id is unknown or expired */
export function getStoredDiagram(id: string): StoredDiagram | null {
    if (!isDiagramId(id)) return null
    const diagram = store().read(id)
    if (!diagram) return null
    if (isExpired(diagram)) {
        store().remove(id)
        return null
    }
    return diagram
}

/** A version of a diagram (the current one when version is omitted) */
export function getDiagramVersion(
    id: string,
    version?: number,
): DiagramVersion | null {
    const diagram = getStoredDiagram(id)
    if (!diagram) return null
    if (version === undefined) return diagram.versions.at(-1) ?? null
    return diagram.versions.find((v) => v.version === version) ?? null
}

/** The current XML of a diagram, or null when unknown or expired */
export function getDiagram(id: string): string | null {
    return getDiagramVersion(id)?.xml ?? null
}

/** Store a new diagram; its first version is 1 */
export function createDiagram(
    xml: string,
    source: VersionSource = "agent",
): { id: string; version: number } {
    const id = randomBytes(16).toString("base64url")
    const now = Date.now()
    store().write({
        id,
        createdAt: now,
        updatedAt: now,
        versions: [{ version: 1, xml, createdAt: now, source }],
    })
    return { id, version: 1 }
}

/** Add a version to a diagram; null when the diagram is unknown or expired */
export function addDiagramVersion(
    id: string,
    xml: string,
    source: VersionSource,
): { version: number } | null {
    const diagram = getStoredDiagram(id)
    if (!diagram) return null
    const now = Date.now()
    const version = (diagram.versions.at(-1)?.version ?? 0) + 1
    store().write({
        ...diagram,
        updatedAt: now,
        versions: [
            ...diagram.versions,
            { version, xml, createdAt: now, source },
        ].slice(-MAX_VERSIONS),
    })
    return { version }
}
