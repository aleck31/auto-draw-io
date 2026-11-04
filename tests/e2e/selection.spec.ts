import { expect, type Page, test } from "@playwright/test"
import { withCanvasNotes } from "@/lib/canvas-note"
import { mockChat, openApp, seedDiagram, sendAndWait } from "./helpers"

/** The cells selected on the canvas go with the next message */

const textTurn = (text: string) => [
    { chunk: { type: "start" } },
    { chunk: { type: "text-start", id: "t" } },
    { chunk: { type: "text-delta", id: "t", delta: text } },
    { chunk: { type: "text-end", id: "t" } },
    { chunk: { type: "finish" } },
]

const diagram = `<mxfile><diagram id="p1" name="Page-1"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="web" value="&lt;b&gt;Web&lt;/b&gt; server" style="rounded=1;" vertex="1" parent="1"><mxGeometry x="40" y="40" width="120" height="60" as="geometry"/></mxCell><mxCell id="db" value="Database" style="rounded=1;" vertex="1" parent="1"><mxGeometry x="240" y="40" width="120" height="60" as="geometry"/></mxCell><mxCell id="link" style="endArrow=classic;" edge="1" parent="1" source="web" target="db"><mxGeometry relative="1" as="geometry"/></mxCell></root></mxGraphModel></diagram></mxfile>`

function select(page: Page, ids: string[]) {
    return page.evaluate((cellIds) => {
        const g = (
            (document.querySelector("iframe") as HTMLIFrameElement)
                .contentWindow as any
        ).__adioEditorUi.editor.graph
        g.setSelectionCells(cellIds.map((id) => g.model.getCell(id)))
    }, ids)
}

const sentSelections = (page: Page) =>
    page.evaluate(() =>
        (window as any).__chatRequests.map(
            (r: any) => r.messages.at(-1).metadata?.selectedCells,
        ),
    )

test("the selected cells go with the message, and stay with it", async ({
    page,
}) => {
    await seedDiagram(page, diagram)
    await mockChat(page, [textTurn("ok"), textTurn("ok")])
    await openApp(page)

    const chip = page.getByTestId("selection-chip")
    await select(page, ["web"])
    await expect(chip).toHaveText("Selected: Web server")
    await select(page, ["web", "link"])
    await expect(chip).toHaveText("2 cells selected")

    await sendAndWait(page, "make these red")
    const [first] = await sentSelections(page)
    expect(first).toEqual([
        { id: "web", label: "Web server", isEdge: false },
        { id: "link", label: "", isEdge: true },
    ])
    // Shown on the sent message; gone from the input, though still selected
    await expect(chip).toHaveCount(1)
    await expect(
        page.locator("form").getByTestId("selection-chip"),
    ).toHaveCount(0)

    // A message with nothing selected sends none
    await select(page, [])
    await sendAndWait(page, "thanks")
    expect((await sentSelections(page))[1]).toBeUndefined()
})

test("a selection taken off the message is not sent", async ({ page }) => {
    await seedDiagram(page, diagram)
    await mockChat(page, [textTurn("ok")])
    await openApp(page)

    await select(page, ["db"])
    const chip = page.locator("form").getByTestId("selection-chip")
    await expect(chip).toHaveText("Selected: Database")
    await chip.getByRole("button").click()
    await expect(chip).toHaveCount(0)
    // A label edit keeps it off
    await page.evaluate(() => {
        const g = (
            (document.querySelector("iframe") as HTMLIFrameElement)
                .contentWindow as any
        ).__adioEditorUi.editor.graph
        g.model.setValue(g.model.getCell("db"), "Postgres")
    })
    await page.waitForTimeout(300)
    await expect(chip).toHaveCount(0)

    await sendAndWait(page, "what is this")
    expect((await sentSelections(page))[0]).toBeUndefined()

    // Selecting again attaches it again
    await select(page, [])
    await select(page, ["db"])
    await expect(chip).toHaveText("Selected: Postgres")
})

test("the model is told which cells the user selected", () => {
    const [message] = withCanvasNotes(
        [
            {
                role: "user",
                parts: [{ type: "text", text: "make it red" }],
                metadata: {
                    canvas: { unchanged: true },
                    selectedCells: [
                        {
                            id: "web",
                            label: 'Web "edge"\nserver',
                            isEdge: false,
                        },
                        { id: "link", label: "", isEdge: true },
                    ],
                },
            },
        ],
        undefined,
    )
    const note = message.parts.at(-1)?.text as string
    expect(note).toContain('- id="web" (shape: Web  edge server)')
    expect(note).toContain('- id="link" (connector)')
    expect(note).toContain("edit_diagram")
})
