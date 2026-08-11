import { randomBytes } from "node:crypto"

/**
 * In-memory store for generated diagrams.
 *
 * Agent/MCP responses return a short id + link instead of the full XML, which
 * keeps responses at a few hundred bytes instead of several KB. Agents fetch the
 * XML on demand; humans open the link in a browser.
 *
 * Deliberately in-memory: the deployment runs a single replica, and diagrams are
 * transient artifacts. Entries expire after TTL and the store is capped, so it
 * cannot grow without bound. Contents are lost on restart - callers must treat a
 * missing id as "expired" rather than an error worth retrying.
 */

const TTL_MS = 720 * 60 * 60 * 1000 // 720h (30 days)
const MAX_ENTRIES = 500

interface Entry {
    xml: string
    createdAt: number
}

// Map preserves insertion order, so the first key is the oldest entry.
const store = new Map<string, Entry>()

function isExpired(entry: Entry, now = Date.now()): boolean {
    return now - entry.createdAt > TTL_MS
}

/** Drop expired entries, then evict oldest ones if still over capacity. */
function prune(): void {
    const now = Date.now()
    for (const [id, entry] of store) {
        if (isExpired(entry, now)) store.delete(id)
    }
    while (store.size > MAX_ENTRIES) {
        const oldest = store.keys().next().value
        if (oldest === undefined) break
        store.delete(oldest)
    }
}

/**
 * Store diagram XML and return its id.
 * The id is a 128-bit random token, so the view link is unguessable and can be
 * opened without an access code (capability URL).
 */
export function putDiagram(xml: string): string {
    const id = randomBytes(16).toString("base64url")
    store.set(id, { xml, createdAt: Date.now() })
    prune()
    return id
}

/** Fetch diagram XML by id, or null when unknown/expired. */
export function getDiagram(id: string): string | null {
    const entry = store.get(id)
    if (!entry) return null
    if (isExpired(entry)) {
        store.delete(id)
        return null
    }
    return entry.xml
}

/** Current store stats (for diagnostics). */
export function diagramStoreStats(): { size: number; maxEntries: number } {
    return { size: store.size, maxEntries: MAX_ENTRIES }
}
