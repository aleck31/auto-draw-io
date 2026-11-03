import { expect, test } from "@playwright/test"
import {
    flowCells,
    mockChat,
    openApp,
    pagesFile,
    type StreamChunk,
    seedDiagram,
    sendAndWait,
    toolCallTurn,
} from "./helpers"

const textTurn = (text: string): StreamChunk[] => [
    { chunk: { type: "start" } },
    { chunk: { type: "text-start", id: "t" } },
    { chunk: { type: "text-delta", id: "t", delta: text } },
    { chunk: { type: "text-end", id: "t" } },
    { chunk: { type: "finish" } },
]

type Message = { role: string; parts: any[]; metadata?: any }
const userNotes = (request: any) =>
    (request.messages as Message[])
        .filter((m) => m.role === "user")
        .map((m) => m.metadata?.canvas)

test("the canvas goes with a message only when the model doesn't know it", async ({
    page,
}) => {
    await seedDiagram(page, pagesFile([["p1", "Page-1", "USER BOX"]]))
    await mockChat(page, [
        toolCallTurn("display_diagram", { xml: flowCells(["A", "B", "C"]) }),
        textTurn("ok"),
        textTurn("ok"),
    ])
    await openApp(page)
    await sendAndWait(page, "draw")
    await sendAndWait(page, "what is on it")
    // A manual edit: the model no longer knows the canvas
    await page.evaluate(() => {
        const g = (
            (document.querySelector("iframe") as HTMLIFrameElement)
                .contentWindow as any
        ).__adioEditorUi.editor.graph
        const a = (Object.values(g.model.cells) as any[]).find(
            (c) => c.value === "A",
        )
        g.model.setValue(a, "A edited")
    })
    await page.waitForTimeout(1500)
    await sendAndWait(page, "and now")

    const requests = await page.evaluate(() => (window as any).__chatRequests)
    expect(requests).toHaveLength(3)
    // 1: the starting canvas; 2: unchanged after the model's own exact drawing; 3: the hand edit
    expect(userNotes(requests[0])[0].xml).toContain("USER BOX")
    expect(userNotes(requests[1])[1]).toEqual({ unchanged: true })
    const third = userNotes(requests[2])
    expect(third[2].xml).toContain("A edited")
    // Earlier messages keep the note they were sent with, so the history is stable
    expect(third[0]).toEqual(userNotes(requests[0])[0])
    expect(third[1]).toEqual({ unchanged: true })
    // The canvas no longer travels as a separate request field for a previous version
    expect(requests[2].previousXml).toBeUndefined()
})

test("an error from the model is shown as an explanation", async ({ page }) => {
    await mockChat(page, [
        [
            { chunk: { type: "start" } },
            {
                chunk: {
                    type: "error",
                    errorText:
                        "The conversation is too long for this model. Start a new chat, or pick a model with a larger context window.",
                },
            },
        ],
    ])
    await openApp(page)
    await sendAndWait(page, "hi")
    await expect(
        page.getByText("The conversation is too long for this model"),
    ).toBeVisible()
})

test("reasoning shows where it happened, between the text and the tool calls", async ({
    page,
}) => {
    const reasoning = (id: string, text: string) => [
        { chunk: { type: "reasoning-start", id } },
        { chunk: { type: "reasoning-delta", id, delta: text } },
        { chunk: { type: "reasoning-end", id } },
    ]
    const text = (id: string, value: string) => [
        { chunk: { type: "text-start", id } },
        { chunk: { type: "text-delta", id, delta: value } },
        { chunk: { type: "text-end", id } },
    ]
    await mockChat(page, [
        [
            { chunk: { type: "start" } },
            ...reasoning("r1", "PLAN-ONE"),
            ...text("t1", "FIRST-ANSWER"),
            ...reasoning("r2", "PLAN-TWO"),
            ...text("t2", "SECOND-ANSWER"),
            { chunk: { type: "finish" } },
        ],
    ])
    await openApp(page)
    await sendAndWait(page, "think twice")
    // Open both reasoning blocks so their text is on the page
    for (const trigger of await page.getByText(/^Thought for/).all()) {
        await trigger.click()
    }
    const order = await page.evaluate(() => {
        const body = document.body.innerText
        return ["PLAN-ONE", "FIRST-ANSWER", "PLAN-TWO", "SECOND-ANSWER"].map(
            (marker) => body.indexOf(marker),
        )
    })
    expect(order.every((i) => i >= 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
})
