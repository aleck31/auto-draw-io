import { expect, type Page, test } from "@playwright/test"
import { add, callTool, cell, idOf } from "./mcp-helpers"

/**
 * An agent's diagram opened in the browser (/d/<id>): the user's edits are
 * saved back, the agent's changes come in, and a conflict is the user's call.
 * Real draw.io, real server; no model.
 */

const revisionOf = async (page: Page, id: string) =>
    (await (await page.request.get(`/api/diagram/${id}`)).json()) as {
        mxfile: string
        revision: number
    }

/** The labels on the editor's canvas */
const labels = (page: Page) =>
    page.evaluate(() => {
        const w = (document.querySelector("iframe") as HTMLIFrameElement | null)
            ?.contentWindow as any
        // Before the editor is there (after a reload): no labels yet
        const cells = w?.__adioEditorUi?.editor.graph.model.cells ?? {}
        return (Object.values(cells) as any[])
            .map((c) => c.value)
            .filter((v) => typeof v === "string" && v)
    })

/** A label changed on the canvas, as the user would */
const relabel = (page: Page, cellId: string, label: string) =>
    page.evaluate(
        ([cellId, label]) => {
            const w = (document.querySelector("iframe") as HTMLIFrameElement)
                .contentWindow as any
            const graph = w.__adioEditorUi.editor.graph
            graph.model.setValue(graph.model.getCell(cellId), label)
        },
        [cellId, label],
    )

const status = (page: Page) => page.getByTestId("sync-status")

async function openShared(page: Page, id: string) {
    await page.goto(`/d/${id}`)
    await page.waitForFunction(
        () =>
            !!(
                (document.querySelector("iframe") as HTMLIFrameElement)
                    ?.contentWindow as any
            )?.__adioEditorUi,
        null,
        { timeout: 30_000 },
    )
    await expect.poll(() => labels(page)).toContain("Web")
}

test.describe("an agent's diagram in the browser", () => {
    test("opening changes nothing; edits are saved; the agent's changes come in", async ({
        page,
        request,
    }) => {
        const id = idOf(
            await callTool(request, "create_diagram", {
                xml: cell("web", "Web", 40),
            }),
        )
        await openShared(page, id)
        await expect(status(page)).toHaveAttribute("data-status", "saved")
        // draw.io rewrites the document as it loads it: that is no edit
        await page.waitForTimeout(3000)
        expect((await revisionOf(page, id)).revision).toBe(1)

        await relabel(page, "web", "Web by hand")
        await expect(status(page)).toHaveAttribute("data-status", "unsaved")
        await expect
            .poll(async () => (await revisionOf(page, id)).revision, {
                timeout: 10_000,
            })
            .toBe(2)
        expect((await revisionOf(page, id)).mxfile).toContain("Web by hand")
        await expect(status(page)).toHaveAttribute("data-status", "saved")

        // The agent adds a cell; back in front, the page shows it
        await callTool(request, "edit_cells", {
            diagram_id: id,
            base_revision: 2,
            operations: [add("db", "Database", 260)],
        })
        await page.evaluate(() => window.dispatchEvent(new Event("focus")))
        await expect.poll(() => labels(page)).toContain("Database")
        expect(await labels(page)).toContain("Web by hand")
        // Shown in place, so its own save back is no new revision
        await page.waitForTimeout(3000)
        expect((await revisionOf(page, id)).revision).toBe(3)
    })

    test("an agent change during an edit is a conflict the user resolves", async ({
        page,
        request,
    }) => {
        const id = idOf(
            await callTool(request, "create_diagram", {
                xml: cell("web", "Web", 40),
            }),
        )
        await openShared(page, id)
        await relabel(page, "web", "Mine")
        // Before the page saves (2 s), the agent writes
        await callTool(request, "edit_cells", {
            diagram_id: id,
            base_revision: 1,
            operations: [add("db", "Agent's", 260)],
        })
        await expect(status(page)).toHaveAttribute("data-status", "conflict", {
            timeout: 10_000,
        })
        // Neither side was overwritten
        expect((await revisionOf(page, id)).mxfile).not.toContain("Mine")

        // A reload keeps the unsaved edit and the conflict
        await page.reload()
        await expect.poll(() => labels(page)).toContain("Mine")
        await expect(status(page)).toHaveAttribute("data-status", "conflict")

        await page.getByRole("button", { name: "Load the latest" }).click()
        await expect.poll(() => labels(page)).toContain("Agent's")
        expect(await labels(page)).not.toContain("Mine")
        await expect(status(page)).toHaveAttribute("data-status", "saved")
        await page.waitForTimeout(3000)
        expect((await revisionOf(page, id)).revision).toBe(2)
    })

    test("keeping my version overwrites the agent's change on purpose", async ({
        page,
        request,
    }) => {
        const id = idOf(
            await callTool(request, "create_diagram", {
                xml: cell("web", "Web", 40),
            }),
        )
        await openShared(page, id)
        await relabel(page, "web", "Mine")
        await callTool(request, "edit_cells", {
            diagram_id: id,
            base_revision: 1,
            operations: [add("db", "Agent's", 260)],
        })
        await expect(status(page)).toHaveAttribute("data-status", "conflict", {
            timeout: 10_000,
        })
        await page.getByRole("button", { name: "Keep my version" }).click()
        await expect(status(page)).toHaveAttribute("data-status", "saved")
        const saved = await revisionOf(page, id)
        expect(saved.revision).toBe(3)
        expect(saved.mxfile).toContain("Mine")
        // The agent's change is still in the history
        const history = await callTool(request, "get_diagram", {
            diagram_id: id,
            version: 2,
        })
        expect(JSON.stringify(history)).toContain("Agent's")
    })

    test("old links open the diagram's own page", async ({ page, request }) => {
        const id = idOf(
            await callTool(request, "create_diagram", {
                xml: cell("web", "Web", 40),
            }),
        )
        await page.goto(`/?d=${id}`)
        await expect(page).toHaveURL(new RegExp(`/d/${id}`))
    })
})
