#!/usr/bin/env node
/**
 * Writes the shape lists of docs/shape-libraries/<library>.md (what
 * get_shape_library tells the model) from the draw.io bundled in public/drawio,
 * so the model is offered the icons that draw.io version draws. Each file keeps
 * its hand-written part above "## Shapes"; the list below it is generated.
 *
 *   node scripts/shape-libraries.mjs           # rewrite the lists
 *   node scripts/shape-libraries.mjs --check   # exit 1 when a list is out of date
 *
 * Reads each library's palettes the way draw.io's sidebar builds them, in a
 * headless Chromium (Playwright). Run after upgrading draw.io.
 */
import fs from "node:fs"
import http from "node:http"
import path from "node:path"
import { chromium } from "playwright"
import { readDrawioVersion } from "./drawio-zip.mjs"

const ROOT = process.cwd()
const DOCS = path.join(ROOT, "docs", "shape-libraries")

/**
 * Per library: the sidebar functions that add its palettes, and the shape
 * name a palette entry's style gives (null to leave the entry out). Palettes
 * whose id matches `skip` (retired icons) are left out. With `stencils`, only
 * names draw.io has a stencil for are kept; with `allStencils`, the list is
 * every stencil of the package instead (GCP's sidebar icons are inline SVG
 * images, not names a model can write).
 */
const LIBRARIES = {
    aws4: {
        palettes: ["addAWS4Palette"],
        skip: /retired/i,
        name: (s) =>
            /resIcon=mxgraph\.aws4\.([\w-]+)/.exec(s)?.[1] ??
            /grIcon=mxgraph\.aws4\.([\w-]+)/.exec(s)?.[1] ??
            /shape=mxgraph\.aws4\.([\w-]+)/.exec(s)?.[1],
        // Shape kinds that take a resIcon/grIcon, not icons themselves
        ignore: ["resourceIcon", "productIcon", "group", "groupCenter"],
        stencils: "mxgraph.aws4",
    },
    azure2: {
        palettes: ["addAzure2Palette"],
        name: (s) => {
            const m =
                /image=img\/lib\/azure2\/([\w-]+)\/([\w.()+-]+)\.svg/.exec(s)
            return m ? `${m[1]}/${m[2]}` : null
        },
        byCategory: true,
    },
    gcp2: {
        palettes: ["addGCP2Palette"],
        name: () => null,
        allStencils: { prefix: "mxgraph.gcp2", sample: "app_engine" },
    },
    kubernetes: {
        palettes: ["addKubernetesPalette"],
        name: (s) =>
            /prIcon=([\w-]+)/.exec(s)?.[1] ??
            /shape=mxgraph\.kubernetes\.([\w-]+)/.exec(s)?.[1],
        ignore: ["icon", "icon2"],
    },
    cisco19: {
        palettes: ["addCisco19Palette"],
        name: (s) =>
            /prIcon=([\w-]+)/.exec(s)?.[1] ??
            /shape=mxgraph\.cisco19\.([\w-]+)/.exec(s)?.[1],
        ignore: ["rect"],
    },
    network: {
        palettes: ["addNetworkPalette"],
        name: (s) => /shape=mxgraph\.networks\.([\w-]+)/.exec(s)?.[1],
        stencils: "mxgraph.networks",
    },
    alibaba_cloud: {
        palettes: ["addAlibabaCloudPalette"],
        name: (s) => /shape=mxgraph\.alibaba_cloud\.([\w-]+)/.exec(s)?.[1],
        stencils: "mxgraph.alibaba_cloud",
    },
}

/** Serves public/drawio on a free local port */
function serveDrawio() {
    const base = path.join(ROOT, "public", "drawio")
    const server = http.createServer((req, res) => {
        const file = path.join(base, decodeURIComponent(req.url.split("?")[0]))
        if (
            !file.startsWith(base) ||
            !fs.existsSync(file) ||
            fs.statSync(file).isDirectory()
        ) {
            res.writeHead(404).end()
            return
        }
        const type = file.endsWith(".js")
            ? "text/javascript"
            : file.endsWith(".html")
              ? "text/html"
              : file.endsWith(".css")
                ? "text/css"
                : file.endsWith(".svg")
                  ? "image/svg+xml"
                  : "application/octet-stream"
        res.writeHead(200, { "Content-Type": type })
        fs.createReadStream(file).pipe(res)
    })
    return new Promise((resolve) =>
        server.listen(0, "127.0.0.1", () => resolve(server)),
    )
}

/** Palette id → styles of its entries, for each library's palette functions */
async function readPalettes(page, functions) {
    return page.evaluate((functions) => {
        const sidebar = window.__adioSidebar
        const proto = Object.getPrototypeOf(sidebar)
        const captured = {}
        let pending = []
        const record = (style) => {
            if (typeof style === "string") pending.push(style)
            return () => document.createElement("a")
        }
        const saved = {
            vertex: proto.createVertexTemplateEntry,
            edge: proto.createEdgeTemplateEntry,
        }
        sidebar.createVertexTemplateEntry = record
        sidebar.createEdgeTemplateEntry = record
        // Both ways a palette registers: with its entries, or with a function
        // that appends them (built beforehand all the same)
        const flush = (id) => {
            captured[id] = [...(captured[id] ?? []), ...pending]
            pending = []
        }
        sidebar.addPaletteFunctions = flush
        sidebar.addPalette = flush
        try {
            for (const fn of functions) sidebar[fn]()
        } finally {
            delete sidebar.createVertexTemplateEntry
            delete sidebar.createEdgeTemplateEntry
            delete sidebar.addPaletteFunctions
            delete sidebar.addPalette
            Object.assign(proto, {
                createVertexTemplateEntry: saved.vertex,
                createEdgeTemplateEntry: saved.edge,
            })
        }
        return captured
    }, functions)
}

/** Every stencil name of a package (loading it with one of its stencils) */
function allStencils(page, { prefix, sample }) {
    return page.evaluate(
        ({ prefix, sample }) => {
            window.mxStencilRegistry.getStencil(`${prefix}.${sample}`)
            return Object.keys(window.mxStencilRegistry.stencils)
                .filter((key) => key.startsWith(`${prefix}.`))
                .map((key) => key.slice(prefix.length + 1))
                .sort((a, b) => a.localeCompare(b, "en"))
        },
        { prefix, sample },
    )
}

/** The names draw.io has a stencil for */
function withStencils(page, prefix, names) {
    return page.evaluate(
        ({ prefix, names }) =>
            names.filter(
                (n) => !!window.mxStencilRegistry.getStencil(`${prefix}.${n}`),
            ),
        { prefix, names },
    )
}

function shapeNames(config, palettes) {
    const names = new Set()
    for (const [id, styles] of Object.entries(palettes)) {
        if (config.skip?.test(id)) continue
        for (const style of styles) {
            const name = config.name(style)
            if (name && !config.ignore?.includes(name)) names.add(name)
        }
    }
    return [...names].sort((a, b) => a.localeCompare(b, "en"))
}

function shapesSection(config, names) {
    const head = `## Shapes (${names.length})\n\n`
    if (!config.byCategory) {
        return `${head}${names.map((n) => `- \`${n}\``).join("\n")}\n`
    }
    const categories = new Map()
    for (const name of names) {
        const [category, shape] = name.split("/")
        categories.set(category, [...(categories.get(category) ?? []), shape])
    }
    const sections = [...categories].map(
        ([category, shapes]) =>
            `### ${category} (${shapes.length})\n\n${shapes.map((s) => `- \`${s}\``).join("\n")}`,
    )
    return `${head}Shapes are organized by category: \`azure2/{category}/{shape}.svg\`\n\n${sections.join("\n\n")}\n`
}

async function main() {
    const check = process.argv.includes("--check")
    const { version } = readDrawioVersion()
    const server = await serveDrawio()
    const browser = await chromium.launch()
    let stale = 0
    try {
        const page = await browser.newPage()
        await page.goto(
            `http://127.0.0.1:${server.address().port}/${version}/index.html?embed=1&proto=json&pwa=0&plugins=0&libraries=1`,
        )
        // The editor, caught by a method it calls on every change of state
        await page.waitForFunction(
            () => {
                const proto = window.EditorUi?.prototype
                if (!proto) return false
                if (!proto.__adioHooked) {
                    proto.__adioHooked = true
                    const update = proto.updateActionStates
                    proto.updateActionStates = function (...args) {
                        window.__adioSidebar = this.sidebar
                        return update.apply(this, args)
                    }
                }
                return !!window.__adioSidebar
            },
            null,
            { timeout: 60_000, polling: 5 },
        )
        for (const [library, config] of Object.entries(LIBRARIES)) {
            let names = config.allStencils
                ? await allStencils(page, config.allStencils)
                : shapeNames(config, await readPalettes(page, config.palettes))
            if (config.stencils) {
                const drawn = await withStencils(page, config.stencils, names)
                const left = names.filter((n) => !drawn.includes(n))
                if (left.length) {
                    console.log(
                        `${library}: left out, no stencil: ${left.join(" ")}`,
                    )
                }
                names = drawn
            }
            if (names.length === 0) {
                throw new Error(
                    `${library}: no shapes found; did draw.io change its sidebar?`,
                )
            }
            const file = path.join(DOCS, `${library}.md`)
            const doc = fs.readFileSync(file, "utf8")
            const at = doc.indexOf("## Shapes")
            const updated = `${at < 0 ? `${doc.trimEnd()}\n\n` : doc.slice(0, at)}${shapesSection(config, names)}`
            if (updated === doc) continue
            stale++
            const before = new Set(
                [...doc.slice(Math.max(at, 0)).matchAll(/^- `([^`]+)`/gm)].map(
                    (m) => m[1],
                ),
            )
            const now = config.byCategory
                ? names.map((n) => n.split("/")[1])
                : names
            const added = now.filter((n) => !before.has(n))
            const removed = [...before].filter((n) => !now.includes(n))
            console.log(
                `${library}: ${now.length} shapes (+${added.length} -${removed.length})${check ? " out of date" : ""}`,
            )
            if (!check) fs.writeFileSync(file, updated)
        }
    } finally {
        await browser.close()
        server.close()
    }
    if (check && stale) {
        console.error("Run node scripts/shape-libraries.mjs to update them.")
        process.exit(1)
    }
}

main().catch((error) => {
    console.error(`[shape-libraries] ${error.message}`)
    process.exit(1)
})
