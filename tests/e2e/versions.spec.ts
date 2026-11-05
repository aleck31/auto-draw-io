import { expect, type Page, test } from "@playwright/test"
import {
    canvasKey,
    canvasState,
    flowCells,
    mockChat,
    openApp,
    sendAndWait,
    toolCallTurn,
} from "./helpers"

/** Each AI change is a version: a card under its tool call, compare and restore */

const editTurn = (cellId: string, label: string) =>
    toolCallTurn("edit_diagram", {
        operations: [
            {
                operation: "update",
                cell_id: cellId,
                new_xml: `<mxCell id="${cellId}" value="${label}" style="rounded=1;whiteSpace=wrap;" vertex="1" parent="1"><mxGeometry x="200" y="40" width="140" height="60" as="geometry"/></mxCell>`,
            },
        ],
    })

async function drawThenEdit(page: Page) {
    await mockChat(page, [
        toolCallTurn("display_diagram", { xml: flowCells(["A", "B", "C"]) }),
        editTurn("v0", "A2"),
    ])
    await openApp(page)
    await sendAndWait(page, "draw")
    await sendAndWait(page, "rename A")
}

const cards = (page: Page) => page.getByTestId("version-card")

test("each AI change gets a card; an older one can be restored and undone", async ({
    page,
}) => {
    await drawThenEdit(page)

    await expect(cards(page)).toHaveCount(2)
    await expect(cards(page).nth(0)).toContainText("v1")
    await expect(cards(page).nth(0)).toContainText("Drew the diagram")
    await expect(cards(page).nth(0)).toContainText("3 shapes, 2 connectors")
    await expect(cards(page).nth(1)).toContainText("Changed 1 shape")
    // The newest is on the canvas; both have a thumbnail
    await expect(
        cards(page).nth(1).getByTestId("version-on-canvas"),
    ).toBeVisible()
    await expect(cards(page).locator("img")).toHaveCount(2)

    await cards(page).nth(0).getByTestId("version-restore").click()
    await expect(
        cards(page).nth(0).getByTestId("version-on-canvas"),
    ).toBeVisible()
    expect((await canvasState(page)).labels).toEqual(["A", "B", "C"])

    // A restore is one undo step
    await canvasKey(page, "Control+z")
    expect((await canvasState(page)).labels).toEqual(["A2", "B", "C"])
    await expect(
        cards(page).nth(1).getByTestId("version-on-canvas"),
    ).toBeVisible()

    // Versions stay with the chat
    await page.reload()
    await openApp(page)
    await expect(cards(page)).toHaveCount(2)
    await expect(cards(page).locator("img")).toHaveCount(2)
})

test("the history button compares the newest version with the canvas", async ({
    page,
}) => {
    await drawThenEdit(page)
    // A hand edit after the AI's last change
    await page.evaluate(() => {
        const g = (
            (document.querySelector("iframe") as HTMLIFrameElement)
                .contentWindow as any
        ).__adioEditorUi.editor.graph
        g.model.setValue(g.model.getCell("v1"), "B edited")
    })
    await page.waitForTimeout(1500)

    await page.getByRole("button", { name: "Compare versions" }).click()
    const dialog = page.getByTestId("compare-dialog")
    await expect(dialog).toContainText("Version 2")
    await expect(dialog).toContainText("Since v2: changed 1 shape.")
    await expect(dialog).toContainText("Changed shapes: B edited")
    await expect(dialog.getByText("2 / 2")).toBeVisible()

    // A picture opens alone, at the size of both; a second click shows both
    const sheets = dialog.locator("figure")
    await expect(sheets).toHaveCount(2)
    await sheets.first().getByRole("button").click()
    await expect(sheets).toHaveCount(1)
    await expect(sheets).toContainText("Version 2")
    await sheets.first().getByRole("button").click()
    await expect(sheets).toHaveCount(2)

    await dialog.getByRole("button", { name: "Previous version" }).click()
    await expect(dialog).toContainText("Version 1")
    await dialog.getByTestId("compare-restore").click()
    await expect(dialog).toHaveCount(0)
    expect((await canvasState(page)).labels).toEqual(["A", "B", "C"])
})

test("regenerating an answer drops its version", async ({ page }) => {
    await mockChat(page, [
        toolCallTurn("display_diagram", { xml: flowCells(["A", "B"]) }),
        toolCallTurn("display_diagram", { xml: flowCells(["X", "Y"]) }),
    ])
    await openApp(page)
    await sendAndWait(page, "draw")
    await expect(cards(page)).toHaveCount(1)

    await page.getByTitle("Regenerate response").click()
    await page.waitForTimeout(1000)
    await page.waitForFunction(
        () => !document.querySelector("button svg.lucide-square"),
    )
    await page.waitForTimeout(2500)
    await expect(cards(page)).toHaveCount(1)
    await expect(cards(page)).toContainText("v1")
    expect((await canvasState(page)).labels).toEqual(["X", "Y"])
})
