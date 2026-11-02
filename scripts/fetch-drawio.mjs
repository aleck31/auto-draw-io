#!/usr/bin/env node
/**
 * Puts the pinned draw.io web app into public/drawio/<version>, which the
 * app embeds from its own origin (same origin lets it drive the editor
 * directly). Runs before `dev` and `build`, and in its own Docker stage.
 *
 * - Does nothing when that version is already there, or when
 *   EMBED_DRAWIO_BASE_URL points to an external draw.io.
 * - DRAWIO_WAR_PATH: use a local draw.war instead of downloading it
 *   (air-gapped builds). Its SHA-256 is checked either way.
 * - Older versions under public/drawio are removed.
 */
import fs from "node:fs"
import path from "node:path"
import { readDrawioVersion, readZipEntries, sha256 } from "./drawio-zip.mjs"

// npm runs this before Next reads the .env files: read them here so an
// external draw.io set in .env.local skips the download too. @next/env is
// absent in the Docker stage, where the build args are real env vars.
try {
    const { loadEnvConfig } = (await import("@next/env")).default
    loadEnvConfig(process.cwd(), process.env.npm_lifecycle_event === "predev")
} catch {
    // ignore
}

const { version, sha256: expected, downloadUrl } = readDrawioVersion()
const ROOT = path.join(process.cwd(), "public", "drawio")
const DEST = path.join(ROOT, version)

function log(message) {
    console.log(`[fetch-drawio] ${message}`)
}

async function readWar() {
    const local = process.env.DRAWIO_WAR_PATH
    if (local) {
        log(`Reading ${local}`)
        return fs.readFileSync(local)
    }
    log(`Downloading draw.io ${version} ...`)
    const res = await fetch(downloadUrl)
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${downloadUrl}`)
    return Buffer.from(await res.arrayBuffer())
}

async function main() {
    if (process.env.EMBED_DRAWIO_BASE_URL) {
        log("EMBED_DRAWIO_BASE_URL is set, skipping the bundled copy")
        return
    }
    // Unpacked into a temporary directory and renamed, so an index.html here
    // means a complete copy
    if (fs.existsSync(path.join(DEST, "index.html"))) return

    const buf = await readWar()
    // The copy runs on the app's own origin: it must be the real release
    const actual = sha256(buf)
    if (actual !== expected) {
        throw new Error(
            `draw.war checksum mismatch: expected ${expected}, got ${actual}`,
        )
    }

    const tmp = `${DEST}.tmp-${process.pid}`
    fs.rmSync(tmp, { recursive: true, force: true })
    let files = 0
    for (const { name, data } of readZipEntries(buf)) {
        if (name.startsWith("WEB-INF/") || name.startsWith("META-INF/")) {
            continue
        }
        const target = path.join(tmp, name)
        if (!target.startsWith(tmp + path.sep)) {
            throw new Error(`Unsafe path in archive: ${name}`)
        }
        fs.mkdirSync(path.dirname(target), { recursive: true })
        fs.writeFileSync(target, data)
        files++
    }
    fs.rmSync(DEST, { recursive: true, force: true })
    fs.renameSync(tmp, DEST)

    for (const entry of fs.readdirSync(ROOT)) {
        if (entry !== version) {
            fs.rmSync(path.join(ROOT, entry), { recursive: true, force: true })
        }
    }
    log(`Installed ${files} files into public/drawio/${version}`)
}

main().catch((error) => {
    console.error(`[fetch-drawio] ${error.message}`)
    console.error(
        "The canvas needs draw.io: check the network, set DRAWIO_WAR_PATH to a local draw.war, or set EMBED_DRAWIO_BASE_URL to an external draw.io.",
    )
    process.exit(1)
})
