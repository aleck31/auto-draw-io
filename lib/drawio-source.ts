import { getAssetUrl } from "@/lib/base-path"
import drawioVersion from "@/scripts/drawio-version.json"

/** External draw.io set at build time; empty uses the bundled copy */
const EXTERNAL_DRAWIO_URL = process.env.EMBED_DRAWIO_BASE_URL || ""

/** Root of the draw.io web app: the bundled copy on this origin, or the external one */
export function drawioBaseUrl(): string {
    if (EXTERNAL_DRAWIO_URL) {
        const base = EXTERNAL_DRAWIO_URL.startsWith("http")
            ? EXTERNAL_DRAWIO_URL
            : `https://${EXTERNAL_DRAWIO_URL}`
        return base.endsWith("/") ? base : `${base}/`
    }
    // Versioned, so its files can be cached as immutable (next.config.ts)
    return getAssetUrl(`/drawio/${drawioVersion.version}/`)
}

/** URL of the editor iframe in draw.io's embed mode */
export function drawioEditorSrc(options: {
    ui: string
    dark: boolean
}): string {
    // Next.js serves no directory index, so the bundled copy needs the file
    const page = EXTERNAL_DRAWIO_URL ? "" : "index.html"
    const url = new URL(`${drawioBaseUrl()}${page}`, window.location.href)
    const params: Record<string, string> = {
        embed: "1",
        proto: "json",
        ui: options.ui,
        spin: "0",
        libraries: "0",
        saveAndExit: "0",
        noExitBtn: "1",
        dark: options.dark ? "1" : "0",
        // The editor runs on our origin: no service worker or PWA install,
        // and no plugins
        pwa: "0",
        plugins: "0",
    }
    for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, value)
    }
    return url.toString()
}
