import type { Page } from "@playwright/test"

/** One chunk of the AI SDK UI message stream, sent after delayMs */
export type StreamChunk = { chunk: Record<string, unknown>; delayMs?: number }

/** A display_diagram / edit_diagram call whose input streams in `pieces` deltas */
export function toolCallTurn(
    toolName: string,
    input: Record<string, unknown>,
    {
        pieces = 10,
        delayMs = 250,
        toolCallId = `call-${toolName}-${Date.now()}`,
    } = {},
): StreamChunk[] {
    const text = JSON.stringify(input)
    const size = Math.ceil(text.length / pieces)
    const deltas: StreamChunk[] = []
    for (let i = 0; i < text.length; i += size) {
        deltas.push({
            chunk: {
                type: "tool-input-delta",
                toolCallId,
                inputTextDelta: text.slice(i, i + size),
            },
            delayMs,
        })
    }
    return [
        { chunk: { type: "start" } },
        { chunk: { type: "start-step" } },
        { chunk: { type: "tool-input-start", toolCallId, toolName } },
        ...deltas,
        {
            chunk: {
                type: "tool-input-available",
                toolCallId,
                toolName,
                input,
            },
            delayMs,
        },
        { chunk: { type: "finish-step" } },
        { chunk: { type: "finish" } },
    ]
}

/**
 * Answers the next POST /api/chat requests with these turns, streamed with
 * their delays. Request bodies are kept in window.__chatRequests.
 */
export async function mockChat(page: Page, turns: StreamChunk[][]) {
    await page.addInitScript((allTurns) => {
        const w = window as any
        w.__chatTurns = allTurns
        w.__chatRequests = []
        const realFetch = window.fetch.bind(window)
        window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
            const url =
                typeof input === "string"
                    ? input
                    : ((input as Request).url ?? String(input))
            if (!url.endsWith("/api/chat") || init?.method !== "POST") {
                return realFetch(input, init)
            }
            w.__chatRequests.push(JSON.parse(String(init.body)))
            const turn = w.__chatTurns.shift() ?? []
            const encoder = new TextEncoder()
            const signal = init.signal
            const body = new ReadableStream({
                async start(controller) {
                    for (const { chunk, delayMs } of turn) {
                        if (delayMs)
                            await new Promise((r) => setTimeout(r, delayMs))
                        if (signal?.aborted) {
                            controller.close()
                            return
                        }
                        controller.enqueue(
                            encoder.encode(
                                `data: ${JSON.stringify(chunk)}\n\n`,
                            ),
                        )
                    }
                    controller.enqueue(encoder.encode("data: [DONE]\n\n"))
                    controller.close()
                },
            })
            return new Response(body, {
                headers: {
                    "content-type": "text/event-stream",
                    "x-vercel-ai-ui-message-stream": "v1",
                },
            })
        }
    }, turns)
}

/** Seeds the canvas the app restores on load */
export async function seedDiagram(page: Page, xml: string) {
    await page.addInitScript((d) => {
        if (sessionStorage.getItem("e2e-seeded")) return
        localStorage.setItem("auto-draw-io-diagram-xml", d)
        sessionStorage.setItem("e2e-seeded", "1")
    }, xml)
}

/** Opens the app and waits until the editor is attached (same origin) */
export async function openApp(page: Page) {
    await page.goto("/", { waitUntil: "domcontentloaded" })
    await page.waitForFunction(
        () =>
            !!(document.querySelector("iframe") as HTMLIFrameElement)
                ?.contentWindow &&
            !!(
                (document.querySelector("iframe") as HTMLIFrameElement)
                    .contentWindow as any
            ).__adioEditorUi,
        null,
        { timeout: 30_000 },
    )
    // The restored diagram (a full load) lands after attach
    await page.waitForTimeout(1500)
    await page.evaluate(() => {
        const w = (document.querySelector("iframe") as HTMLIFrameElement)
            .contentWindow as any
        w.__fullLoads = 0
        w.addEventListener("message", (e: MessageEvent) => {
            try {
                if (JSON.parse(e.data).action === "load") w.__fullLoads++
            } catch {
                // ignore
            }
        })
    })
}

export interface CanvasState {
    page: string
    pages: string[]
    labels: string[]
    enabled: boolean
    undoIndex: number
    undoLength: number
    scale: number
    fullLoads: number
    cellIds: string[]
}

export function canvasState(page: Page): Promise<CanvasState> {
    return page.evaluate(() => {
        const w = (document.querySelector("iframe") as HTMLIFrameElement)
            .contentWindow as any
        const ui = w.__adioEditorUi
        const g = ui.editor.graph
        const um = ui.editor.undoManager
        const cells = Object.values(g.model.cells) as any[]
        return {
            page: ui.currentPage?.getName?.() ?? "",
            pages: (ui.pages ?? []).map((p: any) => p.getName()),
            labels: cells
                .map((c) => c.value)
                .filter((v) => typeof v === "string" && v),
            enabled: g.isEnabled(),
            undoIndex: um.indexOfNextAdd,
            undoLength: um.history.length,
            scale: Number(g.view.scale.toFixed(2)),
            fullLoads: w.__fullLoads ?? 0,
            cellIds: cells.map((c) => String(c.id)),
        }
    })
}

/** Sends a chat message and waits until the turn is over and settled */
export async function sendAndWait(page: Page, text: string) {
    const box = page.locator("textarea").first()
    await box.fill(text)
    await box.press("Control+Enter")
    await page.waitForTimeout(1000)
    await page.waitForFunction(
        () => !document.querySelector("button svg.lucide-square"),
        null,
        { timeout: 60_000 },
    )
    // The turn-end debounce (1.5 s) and autosave
    await page.waitForTimeout(2500)
}

/** Ctrl+Z / Ctrl+Shift+Z with the focus on the canvas */
export async function canvasKey(page: Page, keys: string) {
    // An empty spot near the bottom of the canvas, above the page tabs
    const frame = page.locator("iframe").first()
    const box = await frame.boundingBox()
    if (!box) throw new Error("No canvas")
    await frame.click({
        position: { x: box.width * 0.85, y: box.height * 0.85 },
    })
    await page.keyboard.press(keys)
    await page.waitForTimeout(800)
}

/** An mxfile with pages of one labelled box each */
export function pagesFile(
    pages: [id: string, name: string, label: string][],
): string {
    return `<mxfile>${pages
        .map(
            ([id, name, label]) =>
                `<diagram id="${id}" name="${name}"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="${id}-a" value="${label}" style="rounded=1;" vertex="1" parent="1"><mxGeometry x="40" y="40" width="120" height="60" as="geometry"/></mxCell></root></mxGraphModel></diagram>`,
        )
        .join("")}</mxfile>`
}

/** Bare mxCells of a top-down flow, for display_diagram */
export function flowCells(labels: string[]): string {
    const vertices = labels.map(
        (label, i) =>
            `<mxCell id="v${i}" value="${label}" style="rounded=1;whiteSpace=wrap;" vertex="1" parent="1"><mxGeometry x="200" y="${40 + i * 100}" width="140" height="60" as="geometry"/></mxCell>`,
    )
    const edges = labels
        .slice(1)
        .map(
            (_, i) =>
                `<mxCell id="e${i}" style="endArrow=classic;" edge="1" parent="1" source="v${i}" target="v${i + 1}"><mxGeometry relative="1" as="geometry"/></mxCell>`,
        )
    return [...vertices, ...edges].join("")
}
