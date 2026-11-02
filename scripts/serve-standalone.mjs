#!/usr/bin/env node
/**
 * Serves the standalone build (`npm run build` first) the way the Docker
 * image does: Next's standalone output needs public/ and .next/static next
 * to its server.js. Used by the Playwright tests.
 */
import { spawn } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

const root = process.cwd()
const standalone = path.join(root, ".next", "standalone")
if (!fs.existsSync(path.join(standalone, "server.js"))) {
    console.error(
        "[serve-standalone] No standalone build: run `npm run build` first",
    )
    process.exit(1)
}
for (const [from, to] of [
    ["public", "public"],
    [".next/static", ".next/static"],
]) {
    const target = path.join(standalone, to)
    fs.rmSync(target, { recursive: true, force: true })
    fs.cpSync(path.join(root, from), target, { recursive: true })
}

const server = spawn(process.execPath, ["server.js"], {
    cwd: standalone,
    stdio: "inherit",
    env: { ...process.env, PORT: process.env.PORT || "3200" },
})
for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => server.kill(signal))
}
server.on("exit", (code) => process.exit(code ?? 0))
