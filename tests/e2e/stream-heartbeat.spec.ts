import { expect, test } from "@playwright/test"
import { jsonWithHeartbeat, withHeartbeat } from "../../lib/stream-heartbeat"

/** The keep-alive wrappers of long responses (no browser, no server) */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

test("an SSE stream gets comments while silent, never inside an event", async () => {
    const encoder = new TextEncoder()
    const source = new ReadableStream<Uint8Array>({
        async start(controller) {
            controller.enqueue(encoder.encode('data: {"a":'))
            await sleep(150)
            controller.enqueue(encoder.encode("1}\n\n"))
            await sleep(150)
            controller.enqueue(encoder.encode("data: [DONE]\n\n"))
            controller.close()
        },
    })
    const text = await withHeartbeat(new Response(source), 40).text()
    // Silent inside the first event: no comment there
    expect(text.startsWith('data: {"a":1}\n\n')).toBe(true)
    expect(text).toContain(": keep-alive\n\n")
    expect(text.endsWith("data: [DONE]\n\n")).toBe(true)
})

test("quick JSON work answers with its own status", async () => {
    const response = await jsonWithHeartbeat(
        Promise.resolve({ body: { error: "bad" }, status: 400 }),
        100,
    )
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: "bad" })
})

test("slow JSON work sends spaces, then the result or the failure", async () => {
    const slow = (body: unknown, status: number) =>
        sleep(250).then(() => ({ body, status }))
    const ok = await jsonWithHeartbeat(slow({ id: "x" }, 200), 50)
    expect(ok.status).toBe(200)
    const okText = await ok.text()
    expect(okText.startsWith(" ")).toBe(true)
    expect(JSON.parse(okText)).toEqual({ id: "x" })

    const failed = await jsonWithHeartbeat(slow({ error: "model" }, 502), 50)
    expect(failed.status).toBe(200)
    expect(JSON.parse(await failed.text())).toEqual({
        error: "model",
        status: 502,
    })
})
