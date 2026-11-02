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

type Part = { type: string; state?: string; output?: any }
const toolOutputs = (request: any) =>
    (request.messages as { parts: Part[] }[])
        .flatMap((m) => m.parts)
        .filter(
            (p) => p.type.startsWith("tool-") && p.state === "output-available",
        )

test("a screenshot is sent back to the model, which reviews and fixes the diagram", async ({
    page,
}) => {
    await seedDiagram(page, pagesFile([["p1", "Page-1", "OLD"]]))
    await mockChat(page, [
        toolCallTurn(
            "display_diagram",
            { xml: flowCells(["Start", "Pack", "Ship"]), screenshot: true },
            { toolCallId: "call-draw" },
        ),
        toolCallTurn(
            "edit_diagram",
            {
                operations: [
                    {
                        operation: "add",
                        cell_id: "end",
                        new_xml:
                            '<mxCell id="end" value="End" vertex="1" parent="1"><mxGeometry x="200" y="340" width="140" height="60" as="geometry"/></mxCell>',
                    },
                ],
                screenshot: true,
            },
            { toolCallId: "call-fix" },
        ),
        textTurn("Checked the screenshot: no overlaps."),
    ])
    await openApp(page)
    await sendAndWait(page, "draw a flow and check it")
    // The automatic follow-ups run after the first turn settles
    await page.waitForFunction(
        () => (window as any).__chatRequests.length >= 3,
        null,
        { timeout: 30_000 },
    )
    await page.waitForTimeout(3000)
    const requests = await page.evaluate(() => (window as any).__chatRequests)
    expect(requests).toHaveLength(3)

    // Request 2: the drawing's result carries the PNG, and the canvas sent is the new one
    const second = toolOutputs(requests[1])
    expect(second).toHaveLength(1)
    expect(second[0].output.image).toMatch(/^data:image\/png;base64,/)
    expect(second[0].output.image.length).toBeLessThanOrEqual(140_000)
    expect(requests[1].xml).toContain("Start")
    expect(requests[1].xml).not.toContain("OLD")

    // Request 3: only the latest screenshot travels as an image
    const third = toolOutputs(requests[2])
    expect(third).toHaveLength(2)
    expect(third[0].output.image).toBeUndefined()
    expect(third[0].output.imageOmitted).toBe(true)
    expect(third[1].output.image).toMatch(/^data:image\/png;base64,/)
    expect(requests[2].xml).toContain("End")

    // The tool card shows what the model saw; only the latest keeps its image
    await expect(
        page.getByAltText("Screenshot of the diagram sent to the AI"),
    ).toHaveCount(2)
    const stored = await page.evaluate(
        () => localStorage.getItem("auto-draw-io-messages") || "",
    )
    expect((stored.match(/data:image\/png;base64,/g) || []).length).toBe(1)
})

test("screenshot_diagram on an empty canvas returns an error instead of an image", async ({
    page,
}) => {
    await mockChat(page, [
        toolCallTurn("screenshot_diagram", {}, { toolCallId: "call-look" }),
        textTurn("The canvas is empty."),
    ])
    await openApp(page)
    await sendAndWait(page, "look at it")
    await page.waitForTimeout(3000)
    const requests = await page.evaluate(() => (window as any).__chatRequests)
    const errors = (requests.at(-1).messages as { parts: Part[] }[])
        .flatMap((m) => m.parts)
        .filter((p) => p.type === "tool-screenshot_diagram")
    expect(errors[0].state).toBe("output-error")
})

test("a diagram call without screenshot does not trigger a follow-up request", async ({
    page,
}) => {
    await mockChat(page, [
        toolCallTurn("display_diagram", { xml: flowCells(["A", "B"]) }),
    ])
    await openApp(page)
    await sendAndWait(page, "draw")
    await page.waitForTimeout(3000)
    expect(
        await page.evaluate(() => (window as any).__chatRequests.length),
    ).toBe(1)
})
