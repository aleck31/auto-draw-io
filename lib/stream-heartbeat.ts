/**
 * Keeps long responses from being closed by proxies that drop a response
 * after it has sent nothing for a while (a load balancer's idle timeout, 60 s
 * by default on AWS ALB; Cloudflare after 125 s). Some providers send a tool
 * call's input only once it is complete, so a big diagram can leave a stream
 * silent for minutes.
 *
 * withHeartbeat is adapted from next-ai-draw-io (lib/stream-heartbeat.ts,
 * Apache-2.0).
 */

const QUIET_MS = 20_000
const encoder = new TextEncoder()
const PING = encoder.encode(": keep-alive\n\n")

/**
 * The SSE response with a comment written whenever it has sent nothing for
 * quietMs; the AI SDK's parser skips comment lines.
 */
export function withHeartbeat(
    response: Response,
    quietMs = QUIET_MS,
): Response {
    if (!response.body) return response
    let timer: ReturnType<typeof setInterval> | undefined
    let lastSent = Date.now()
    // Pings go only between events, never inside one split across chunks
    let atEventEnd = true
    const body = response.body.pipeThrough(
        new TransformStream<Uint8Array, Uint8Array>({
            start(controller) {
                timer = setInterval(() => {
                    if (!atEventEnd || Date.now() - lastSent < quietMs) return
                    lastSent = Date.now()
                    try {
                        controller.enqueue(PING)
                    } catch {
                        // The client went: the stream is cancelled
                        clearInterval(timer)
                    }
                }, quietMs / 4)
            },
            transform(chunk, controller) {
                lastSent = Date.now()
                const n = chunk.length
                atEventEnd =
                    n >= 2 && chunk[n - 1] === 10 && chunk[n - 2] === 10
                controller.enqueue(chunk)
            },
            flush() {
                clearInterval(timer)
            },
        }),
    )
    return new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
    })
}

/**
 * A JSON response for work that may take minutes. When the work finishes
 * within quietMs, the response is the usual one with its status. Otherwise it
 * starts as 200 and writes a space every quietMs (whitespace before a JSON
 * value is allowed), then the result; a failure after that point is the body
 * { error, status } with the status it would have had.
 */
export function jsonWithHeartbeat(
    work: Promise<{ body: unknown; status: number }>,
    quietMs = QUIET_MS,
): Promise<Response> {
    const json = (body: unknown, status: number) =>
        Response.json(body, { status })
    return new Promise((resolve) => {
        let streaming = false
        const timer = setTimeout(() => {
            streaming = true
            let ping: ReturnType<typeof setInterval> | undefined
            const stream = new ReadableStream<Uint8Array>({
                start(controller) {
                    controller.enqueue(encoder.encode(" "))
                    ping = setInterval(() => {
                        try {
                            controller.enqueue(encoder.encode(" "))
                        } catch {
                            clearInterval(ping)
                        }
                    }, quietMs)
                    void work.then(({ body, status }) => {
                        clearInterval(ping)
                        const final =
                            status >= 400 && body && typeof body === "object"
                                ? { ...body, status }
                                : body
                        try {
                            controller.enqueue(
                                encoder.encode(JSON.stringify(final)),
                            )
                            controller.close()
                        } catch {
                            // The client went
                        }
                    })
                },
                cancel() {
                    clearInterval(ping)
                },
            })
            resolve(
                new Response(stream, {
                    headers: { "Content-Type": "application/json" },
                }),
            )
        }, quietMs)
        void work.then(({ body, status }) => {
            if (streaming) return
            clearTimeout(timer)
            resolve(json(body, status))
        })
    })
}
