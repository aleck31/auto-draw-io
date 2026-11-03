import { getAssetUrl } from "@/lib/base-path"
import drawioVersion from "@/scripts/drawio-version.json"

/** Root of the bundled draw.io on this origin; versioned, so its files are cached as immutable (next.config.ts) */
export function drawioBaseUrl(): string {
    return getAssetUrl(`/drawio/${drawioVersion.version}/`)
}

/** URL of the editor iframe in draw.io's embed mode */
export function drawioEditorSrc(options: {
    ui: string
    dark: boolean
}): string {
    // Next.js serves no directory index
    const url = new URL(`${drawioBaseUrl()}index.html`, window.location.href)
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
