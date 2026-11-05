/**
 * Diagram versions: each AI change that lands on the canvas, kept with the
 * chat so the user can compare it with the canvas and restore it.
 *
 * Adapted from next-ai-draw-io (stores/versions-store.ts, lib/version-text.ts,
 * Apache-2.0).
 */
import type { ChangeSummary } from "@/lib/diagram-diff"

export interface DiagramVersion {
    /** The tool call that made it; its card goes with that call */
    id: string
    /** Counts up through the chat; stays when older versions are dropped */
    number: number
    /** The whole document after the change */
    xml: string
    /** The page the change was made on */
    pageId: string | null
    /** Thumbnail as an SVG data URL; undefined while it is made, "" for none */
    svg?: string
    fromScratch: boolean
    summary: ChangeSummary
}

export const MAX_VERSIONS = 20
const STORAGE_KEY = "auto-draw-io-versions"
// Under the localStorage quota, older versions give up their thumbnails first
const THUMBNAILS_KEPT_WHEN_FULL = 5

const plural = (n: number, one: string, other: string) =>
    `${n} ${n === 1 ? one : other}`

/** "Added 2 shapes, changed 1 connector"; for a new diagram, "3 shapes, 2 connectors" */
export function describeChange(version: DiagramVersion): string {
    const s = version.summary
    if (version.fromScratch) {
        return [
            plural(s.shapesAdded, "shape", "shapes"),
            plural(s.edgesAdded, "connector", "connectors"),
        ].join(", ")
    }
    return describeSummary(s)
}

export function describeSummary(s: ChangeSummary): string {
    const pieces = (
        [
            ["added", s.shapesAdded, s.edgesAdded],
            ["changed", s.shapesChanged, s.edgesChanged],
            ["removed", s.shapesRemoved, s.edgesRemoved],
        ] as const
    ).flatMap(([verb, shapes, edges]) => {
        const things = [
            shapes > 0 ? plural(shapes, "shape", "shapes") : "",
            edges > 0 ? plural(edges, "connector", "connectors") : "",
        ].filter(Boolean)
        return things.length > 0 ? [`${verb} ${things.join(" and ")}`] : []
    })
    if (pieces.length === 0) return "No visible change"
    const text = pieces.join(", ")
    return text.charAt(0).toUpperCase() + text.slice(1)
}

/**
 * A thumbnail from draw.io's xmlsvg export: the same picture without the
 * diagram XML the export embeds, which is most of its size
 */
export function thumbnailOf(dataUrl: string): string {
    const prefix = "data:image/svg+xml;base64,"
    if (!dataUrl.startsWith(prefix)) return dataUrl
    try {
        const bytes = Uint8Array.from(atob(dataUrl.slice(prefix.length)), (c) =>
            c.charCodeAt(0),
        )
        const svg = new TextDecoder()
            .decode(bytes)
            .replace(/\scontent="[^"]*"/, "")
        const encoded = new TextEncoder().encode(svg)
        let binary = ""
        for (let i = 0; i < encoded.length; i += 0x8000) {
            binary += String.fromCharCode(...encoded.subarray(i, i + 0x8000))
        }
        return prefix + btoa(binary)
    } catch {
        return dataUrl
    }
}

/** Saves the versions; when storage is full, without older thumbnails */
export function storeVersions(versions: DiagramVersion[]) {
    const attempts = [
        versions,
        versions.map((v, i) =>
            i < versions.length - THUMBNAILS_KEPT_WHEN_FULL
                ? { ...v, svg: "" }
                : v,
        ),
    ]
    for (const attempt of attempts) {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(attempt))
            return
        } catch {
            // Quota: try with less
        }
    }
    console.warn("[versions] Not saved: browser storage is full")
}

export function loadVersions(): DiagramVersion[] {
    try {
        const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]")
        if (!Array.isArray(stored)) return []
        // A thumbnail still being made when the page closed never comes
        return stored.map((v) => ({ ...v, svg: v.svg ?? "" }))
    } catch {
        return []
    }
}

/** The tool calls in these chat messages, for keeping their versions */
export function toolCallIdsOf(messages: { parts?: object[] }[]): Set<string> {
    const ids = new Set<string>()
    for (const message of messages) {
        for (const part of message.parts ?? []) {
            const id = (part as { toolCallId?: unknown }).toolCallId
            if (typeof id === "string") ids.add(id)
        }
    }
    return ids
}
