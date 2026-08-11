import pako from "pako"

/**
 * Shareable diagram links.
 *
 * A diagram is encoded into the URL *fragment* (`#R<data>`), mirroring
 * draw.io's own scheme. The fragment is never sent to the server, so links work
 * without any server-side storage, add nothing to request logs, and are not
 * subject to query-string length limits.
 */

const FRAGMENT_PREFIX = "#R"

/** Encode diagram XML into a URL fragment (raw-deflate + base64). */
export function encodeDiagramFragment(xml: string): string {
    const deflated = pako.deflateRaw(new TextEncoder().encode(xml))
    let binary = ""
    for (const byte of deflated) {
        binary += String.fromCharCode(byte)
    }
    const base64 =
        typeof btoa === "function"
            ? btoa(binary)
            : Buffer.from(binary, "binary").toString("base64")
    return `${FRAGMENT_PREFIX}${encodeURIComponent(base64)}`
}

/**
 * Decode a `#R...` fragment back into diagram XML.
 * Returns null when the fragment is absent or malformed.
 */
export function decodeDiagramFragment(fragment: string): string | null {
    if (!fragment?.startsWith(FRAGMENT_PREFIX)) return null
    try {
        const base64 = decodeURIComponent(
            fragment.slice(FRAGMENT_PREFIX.length),
        )
        const binary =
            typeof atob === "function"
                ? atob(base64)
                : Buffer.from(base64, "base64").toString("binary")
        const bytes = new Uint8Array(binary.length)
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i)
        }
        const xml = new TextDecoder().decode(
            pako.inflateRaw(bytes) as Uint8Array,
        )
        return xml.includes("<mx") ? xml : null
    } catch {
        return null
    }
}

/**
 * Build a link that opens the diagram rendered in this deployment.
 * Requires APP_BASE_URL (e.g. https://autodraw.example.com); returns undefined
 * when unset so callers can simply omit the link.
 */
export function buildDiagramViewUrl(xml: string): string | undefined {
    const base = process.env.APP_BASE_URL?.trim().replace(/\/$/, "")
    if (!base) return undefined
    return `${base}/${encodeDiagramFragment(xml)}`
}
