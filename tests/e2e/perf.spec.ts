import { expect, test } from "@playwright/test"
import {
    canvasState,
    flowCells,
    mockChat,
    openApp,
    toolCallTurn,
} from "./helpers"

// A 40-cell diagram streamed over about 60 s. The previews run on the app's
// main thread (same-origin frame), so it is measured as event-loop lag: a
// 50 ms timer that fires late was blocked for that long. (The longtask
// observer reports nothing in headless Chromium.)
test("streaming previews keep the main thread responsive", async ({ page }) => {
    test.setTimeout(150_000)
    const labels = Array.from({ length: 20 }, (_, i) => `Service ${i + 1}`)
    await mockChat(page, [
        toolCallTurn(
            "display_diagram",
            { xml: flowCells(labels) },
            { pieces: 240, delayMs: 250 },
        ),
    ])
    await openApp(page)
    await page.evaluate(() => {
        const w = window as any
        w.__lags = []
        let last = performance.now()
        w.__lagTimer = setInterval(() => {
            const now = performance.now()
            w.__lags.push(now - last - 50)
            last = now
        }, 50)
    })
    const box = page.locator("textarea").first()
    await box.fill("draw")
    const t0 = Date.now()
    await box.press("Control+Enter")
    await page.waitForTimeout(1000)
    await page.waitForFunction(
        () => !document.querySelector("button svg.lucide-square"),
        null,
        { timeout: 120_000 },
    )
    const seconds = (Date.now() - t0) / 1000
    await page.waitForTimeout(2500)
    const lags: number[] = await page.evaluate(() => {
        const w = window as any
        clearInterval(w.__lagTimer)
        return w.__lags
    })
    const blocked = lags.filter((l) => l > 50)
    const total = blocked.reduce((a, b) => a + b, 0)
    const max = Math.max(0, ...lags)
    const sorted = [...lags].sort((a, b) => a - b)
    const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0
    console.log(
        `stream ${seconds.toFixed(0)}s: ${lags.length} samples, p95 lag ${p95.toFixed(0)} ms, max ${max.toFixed(0)} ms, ${blocked.length} stalls over 50 ms totalling ${total.toFixed(0)} ms (${((total / (seconds * 1000)) * 100).toFixed(1)}% of the time)`,
    )
    const state = await canvasState(page)
    expect(state.labels).toHaveLength(20)
    expect(state.fullLoads).toBe(0)
    // Budget: under 15% of the stream blocked, no stall above 250 ms
    expect(total / (seconds * 1000)).toBeLessThan(0.15)
    expect(max).toBeLessThan(250)
})
