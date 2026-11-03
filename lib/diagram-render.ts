import { type Browser, chromium } from "playwright-core"

/**
 * PNGs of stored diagrams, rendered by a headless Chromium that opens this
 * server's own /render/<id> page (the bundled draw.io viewer), so they look the
 * way the editor shows them and no other host is contacted.
 *
 * The browser starts on the first request and closes after IDLE_MS without
 * one. Renders run one at a time. CHROMIUM_PATH points at the browser binary
 * (the Docker image sets it); without it Playwright's own browser is used.
 */

const IDLE_MS = 60_000
const RENDER_TIMEOUT_MS = 30_000
/** Model screenshots fit in this box and size, as the web chat's do */
const MODEL_MAX_WIDTH = 1000
const MODEL_MAX_HEIGHT = 700
const MODEL_MAX_BASE64 = 140_000

export class RenderUnavailableError extends Error {
    constructor(message: string) {
        super(message)
        this.name = "RenderUnavailableError"
    }
}

let browser: Promise<Browser> | null = null
let idleTimer: ReturnType<typeof setTimeout> | null = null
let queue: Promise<unknown> = Promise.resolve()

function getBrowser(): Promise<Browser> {
    if (idleTimer) clearTimeout(idleTimer)
    if (!browser) {
        browser = chromium
            .launch({ executablePath: process.env.CHROMIUM_PATH || undefined })
            .catch((error) => {
                browser = null
                throw new RenderUnavailableError(
                    `No browser to render with: ${(error as Error).message.split("\n")[0]}`,
                )
            })
    }
    return browser
}

function closeWhenIdle(): void {
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = setTimeout(() => {
        const closing = browser
        browser = null
        void closing?.then((b) => b.close()).catch(() => {})
    }, IDLE_MS)
    idleTimer.unref?.()
}

/** This server's own address, as the browser in this container reaches it */
function renderPageUrl(id: string, version?: number): string {
    const port = process.env.PORT || "3000"
    const base = process.env.AUTO_BASE_PATH || ""
    const query = version === undefined ? "" : `?v=${version}`
    return `http://127.0.0.1:${port}${base}/render/${encodeURIComponent(id)}${query}`
}

async function capture(
    id: string,
    version: number | undefined,
    scale: number,
): Promise<{ png: Buffer; width: number; height: number }> {
    const context = await (await getBrowser()).newContext({
        deviceScaleFactor: scale,
        viewport: { width: 2000, height: 1500 },
    })
    try {
        const page = await context.newPage()
        page.setDefaultTimeout(RENDER_TIMEOUT_MS)
        const response = await page.goto(renderPageUrl(id, version), {
            waitUntil: "networkidle",
        })
        if (!response?.ok()) {
            throw new Error(`The render page answered ${response?.status()}`)
        }
        const svg = await page.waitForSelector(".mxgraph svg")
        const box = await svg.boundingBox()
        const png = await svg.screenshot({ type: "png" })
        return {
            png,
            width: Math.ceil(box?.width ?? 0),
            height: Math.ceil(box?.height ?? 0),
        }
    } finally {
        await context.close()
    }
}

function serialized<T>(run: () => Promise<T>): Promise<T> {
    const result = queue.then(run, run)
    queue = result.catch(() => {})
    return result.finally(closeWhenIdle)
}

/** A PNG of the diagram at this scale (2 for documents) */
export function renderDiagramPng(
    id: string,
    options: { version?: number; scale?: number } = {},
): Promise<Buffer> {
    return serialized(
        async () =>
            (await capture(id, options.version, options.scale ?? 2)).png,
    )
}

/**
 * A PNG for a model to look at: scaled to fill MODEL_MAX_WIDTH x
 * MODEL_MAX_HEIGHT (at most 2x, so small diagrams stay readable), and rendered
 * again smaller while it is over MODEL_MAX_BASE64.
 */
export function renderDiagramForModel(
    id: string,
    version?: number,
): Promise<string> {
    return serialized(async () => {
        let shot = await capture(id, version, 1)
        let scale = Math.min(
            2,
            MODEL_MAX_WIDTH / Math.max(shot.width, 1),
            MODEL_MAX_HEIGHT / Math.max(shot.height, 1),
        )
        for (let attempt = 0; attempt < 4; attempt++) {
            if (scale !== 1) shot = await capture(id, version, scale)
            const base64 = shot.png.toString("base64")
            if (base64.length <= MODEL_MAX_BASE64 || attempt === 3) {
                return base64
            }
            scale *= 0.7
        }
        return shot.png.toString("base64")
    })
}
