import { expect, test } from "@playwright/test"
import {
    canvasKey,
    canvasState,
    flowCells,
    mockChat,
    openApp,
    pagesFile,
    seedDiagram,
    sendAndWait,
    toolCallTurn,
} from "./helpers"

const ONE_BOX = pagesFile([["p1", "Page-1", "USER BOX"]])

test.describe("AI edits on the same-origin editor", () => {
    test("display_diagram is one undo step back to the canvas before it", async ({
        page,
    }) => {
        await seedDiagram(page, ONE_BOX)
        await mockChat(page, [
            toolCallTurn(
                "display_diagram",
                { xml: flowCells(["Start", "Pack", "Ship", "End"]) },
                { pieces: 12 },
            ),
        ])
        await openApp(page)
        const before = await canvasState(page)
        expect(before.labels).toEqual(["USER BOX"])

        await sendAndWait(page, "draw a flow")
        const after = await canvasState(page)
        expect(after.labels).toEqual(["Start", "Pack", "Ship", "End"])
        expect(after.undoLength).toBe(before.undoLength + 1)
        expect(after.fullLoads).toBe(0)
        expect(after.enabled).toBe(true)

        await canvasKey(page, "Control+z")
        expect((await canvasState(page)).labels).toEqual(["USER BOX"])
        await canvasKey(page, "Control+Shift+z")
        expect((await canvasState(page)).labels).toEqual([
            "Start",
            "Pack",
            "Ship",
            "End",
        ])
    })

    test("edit_diagram is one undo step and keeps the user's earlier undo history", async ({
        page,
    }) => {
        await seedDiagram(page, ONE_BOX)
        await mockChat(page, [
            toolCallTurn(
                "edit_diagram",
                {
                    operations: [
                        {
                            operation: "add",
                            cell_id: "cache",
                            new_xml:
                                '<mxCell id="cache" value="Cache" vertex="1" parent="1"><mxGeometry x="300" y="40" width="120" height="60" as="geometry"/></mxCell>',
                        },
                        {
                            operation: "add",
                            cell_id: "queue",
                            new_xml:
                                '<mxCell id="queue" value="Queue" vertex="1" parent="1"><mxGeometry x="300" y="160" width="120" height="60" as="geometry"/></mxCell>',
                        },
                    ],
                },
                { pieces: 8 },
            ),
        ])
        await openApp(page)
        // A manual edit and a zoom before the AI turn
        await page.evaluate(() => {
            const g = (
                (document.querySelector("iframe") as HTMLIFrameElement)
                    .contentWindow as any
            ).__adioEditorUi.editor.graph
            const box = (Object.values(g.model.cells) as any[]).find(
                (c) => c.value === "USER BOX",
            )
            g.moveCells([box], 200, 0)
            g.zoomTo(0.75)
        })
        const before = await canvasState(page)

        await sendAndWait(page, "add a cache and a queue")
        const after = await canvasState(page)
        expect(after.labels.sort()).toEqual(["Cache", "Queue", "USER BOX"])
        expect(after.undoLength).toBe(before.undoLength + 1)
        expect(after.scale).toBe(0.75)
        expect(after.fullLoads).toBe(0)

        await canvasKey(page, "Control+z")
        expect((await canvasState(page)).labels).toEqual(["USER BOX"])
        // The manual move made before the AI turn is still undoable
        const boxX = () =>
            page.evaluate(() => {
                const g = (
                    (document.querySelector("iframe") as HTMLIFrameElement)
                        .contentWindow as any
                ).__adioEditorUi.editor.graph
                return (Object.values(g.model.cells) as any[]).find(
                    (c) => c.value === "USER BOX",
                ).geometry.x
            })
        expect(await boxX()).toBe(240)
        await canvasKey(page, "Control+z")
        expect(await boxX()).toBe(40)
        const ids = (await canvasState(page)).cellIds
        expect(new Set(ids).size).toBe(ids.length)
    })

    test("the canvas is locked while a tool call streams", async ({ page }) => {
        await seedDiagram(
            page,
            pagesFile([
                ["p1", "Overview", "P1"],
                ["p2", "Network", "P2"],
            ]),
        )
        await mockChat(page, [
            toolCallTurn(
                "display_diagram",
                { xml: flowCells(["A", "B", "C", "D", "E", "F"]) },
                { pieces: 20, delayMs: 400 },
            ),
        ])
        await openApp(page)
        const box = page.locator("textarea").first()
        await box.fill("draw")
        await box.press("Control+Enter")
        await page.waitForFunction(
            () =>
                !(
                    (document.querySelector("iframe") as HTMLIFrameElement)
                        .contentWindow as any
                ).__adioEditorUi.editor.graph.isEnabled(),
            null,
            { timeout: 15_000 },
        )
        const locked = await canvasState(page)
        // Page tab, the Undo action and Delete change nothing
        await page
            .frameLocator("iframe")
            .locator(".geTabContainer")
            .getByText("Network")
            .first()
            .click()
        await page.evaluate(() =>
            (
                (document.querySelector("iframe") as HTMLIFrameElement)
                    .contentWindow as any
            ).__adioEditorUi.actions
                .get("undo")
                .funct(),
        )
        await page.keyboard.press("Delete")
        const during = await canvasState(page)
        expect(during.page).toBe("Overview")
        expect(during.undoLength).toBe(locked.undoLength)
        expect(during.enabled).toBe(false)

        await page.waitForFunction(
            () => !document.querySelector("button svg.lucide-square"),
            null,
            { timeout: 30_000 },
        )
        await page.waitForTimeout(2500)
        const after = await canvasState(page)
        expect(after.enabled).toBe(true)
        expect(after.pages).toEqual(["Overview", "Network"])
    })

    test("stopping mid-stream commits what is shown as one undo step", async ({
        page,
    }) => {
        await seedDiagram(page, ONE_BOX)
        await mockChat(page, [
            toolCallTurn(
                "display_diagram",
                { xml: flowCells(["A", "B", "C", "D", "E", "F", "G", "H"]) },
                { pieces: 30, delayMs: 400 },
            ),
        ])
        await openApp(page)
        const box = page.locator("textarea").first()
        await box.fill("draw")
        await box.press("Control+Enter")
        await page.waitForFunction(
            () =>
                !(
                    (document.querySelector("iframe") as HTMLIFrameElement)
                        .contentWindow as any
                ).__adioEditorUi.editor.graph.isEnabled(),
            null,
            { timeout: 15_000 },
        )
        await page.waitForTimeout(1500)
        await page.locator("button:has(svg.lucide-square)").first().click()
        await page.waitForTimeout(3000)
        const after = await canvasState(page)
        expect(after.enabled).toBe(true)
        expect(after.labels).not.toContain("USER BOX")
        expect(after.labels.length).toBeGreaterThan(0)
        await canvasKey(page, "Control+z")
        expect((await canvasState(page)).labels).toEqual(["USER BOX"])
    })

    test("a failed edit_diagram reverts its preview", async ({ page }) => {
        await seedDiagram(page, ONE_BOX)
        await mockChat(page, [
            toolCallTurn(
                "edit_diagram",
                {
                    operations: [
                        {
                            operation: "add",
                            cell_id: "ok",
                            new_xml:
                                '<mxCell id="ok" value="Added" vertex="1" parent="1"><mxGeometry x="300" y="40" width="120" height="60" as="geometry"/></mxCell>',
                        },
                        // Fails: update needs an existing cell
                        {
                            operation: "update",
                            cell_id: "does-not-exist",
                            new_xml:
                                '<mxCell id="does-not-exist" value="X" vertex="1" parent="1"><mxGeometry x="0" y="0" width="10" height="10" as="geometry"/></mxCell>',
                        },
                    ],
                },
                { pieces: 6 },
            ),
            // The automatic retry after the tool error: a plain text answer
            [
                { chunk: { type: "start" } },
                { chunk: { type: "text-start", id: "t1" } },
                { chunk: { type: "text-delta", id: "t1", delta: "Sorry." } },
                { chunk: { type: "text-end", id: "t1" } },
                { chunk: { type: "finish" } },
            ],
        ])
        await openApp(page)
        const before = await canvasState(page)
        await sendAndWait(page, "edit")
        const after = await canvasState(page)
        expect(after.labels).toEqual(["USER BOX"])
        expect(after.undoLength).toBe(before.undoLength)
        expect(after.enabled).toBe(true)
    })
})

test("crossing the mobile breakpoint keeps the canvas usable", async ({
    page,
}) => {
    await seedDiagram(page, ONE_BOX)
    await mockChat(page, [
        toolCallTurn("display_diagram", { xml: flowCells(["A", "B"]) }),
    ])
    await openApp(page)
    const loading = () =>
        page.evaluate(() => document.body.innerText.includes("Loading Draw.io"))
    for (const width of [700, 1400]) {
        await page.setViewportSize({ width, height: 900 })
        await page.waitForTimeout(1500)
        expect(await loading()).toBe(false)
    }
    // The canvas still takes AI edits in place
    await sendAndWait(page, "draw")
    const state = await canvasState(page)
    expect(state.labels).toEqual(["A", "B"])
    expect(state.fullLoads).toBe(0)
})

test("a reload does not replay the last tool output over later edits", async ({
    page,
}) => {
    await seedDiagram(page, ONE_BOX)
    await mockChat(page, [
        toolCallTurn("display_diagram", { xml: flowCells(["A", "B"]) }),
    ])
    await openApp(page)
    await sendAndWait(page, "draw")
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
    // localStorage saves are debounced by 1 s
    await page.waitForTimeout(2000)
    await page.reload({ waitUntil: "domcontentloaded" })
    await openApp(page)
    await page.waitForTimeout(2000)
    expect((await canvasState(page)).labels.sort()).toEqual(["A edited", "B"])
})

test.describe("Multi-page files", () => {
    const THREE = pagesFile([
        ["p1", "Overview", "P1 box"],
        ["p2", "Network", "P2 box"],
        ["p3", "Data", "P3 box"],
    ])

    test("the AI sees page 1 and the page names, and the other pages stay", async ({
        page,
    }) => {
        await seedDiagram(page, THREE)
        await mockChat(page, [
            toolCallTurn("display_diagram", {
                xml: flowCells(["New", "Flow"]),
            }),
        ])
        await openApp(page)
        await sendAndWait(page, "redraw page 1")

        const request = await page.evaluate(
            () => (window as any).__chatRequests[0],
        )
        expect(request.pages).toEqual(["Overview", "Network", "Data"])
        expect(request.xml.startsWith("<mxGraphModel")).toBe(true)
        expect(request.xml).toContain("P1 box")
        expect(request.xml).not.toContain("P2 box")

        const after = await canvasState(page)
        expect(after.pages).toEqual(["Overview", "Network", "Data"])
        expect(after.fullLoads).toBe(0)
        const stored = await page.evaluate(
            () => localStorage.getItem("auto-draw-io-diagram-xml") || "",
        )
        expect(stored).toContain("P2 box")
        expect(stored).toContain("P3 box")
        expect(stored).not.toMatch(/_dup\d/)
    })

    test("an AI change while the user is on another page loads in full and returns them there", async ({
        page,
    }) => {
        await seedDiagram(page, THREE)
        await mockChat(page, [
            toolCallTurn("display_diagram", {
                xml: flowCells(["New", "Flow"]),
            }),
        ])
        await openApp(page)
        await page
            .frameLocator("iframe")
            .locator(".geTabContainer")
            .getByText("Data")
            .first()
            .click()
        await page.waitForTimeout(500)
        expect((await canvasState(page)).page).toBe("Data")

        await sendAndWait(page, "redraw page 1")
        const after = await canvasState(page)
        expect(after.page).toBe("Data")
        expect(after.pages).toEqual(["Overview", "Network", "Data"])
        const stored = await page.evaluate(
            () => localStorage.getItem("auto-draw-io-diagram-xml") || "",
        )
        expect(stored).toContain("New")
        expect(stored).toContain("P3 box")
    })
})

test.describe("Same-origin draw.io", () => {
    test("loads from this origin with frame and cache headers, and calls no external host", async ({
        page,
        request,
    }) => {
        const external = new Set<string>()
        page.on("request", (r) => {
            const host = new URL(r.url()).hostname
            if (host !== "localhost") external.add(host)
        })
        await mockChat(page, [
            toolCallTurn("display_diagram", { xml: flowCells(["A", "B"]) }),
        ])
        await openApp(page)
        const src = await page.locator("iframe").first().getAttribute("src")
        expect(src).toMatch(
            /^http:\/\/localhost:\d+\/drawio\/[\d.]+\/index\.html\?/,
        )
        expect(src).toContain("pwa=0")
        await sendAndWait(page, "draw")
        expect([...external]).toEqual([])
        expect(
            await page.evaluate(
                async () =>
                    (await navigator.serviceWorker.getRegistrations()).length,
            ),
        ).toBe(0)

        const res = await request.get(new URL(src as string).pathname)
        expect(res.headers()["content-security-policy"]).toBe(
            "frame-ancestors 'self'",
        )
        expect(res.headers()["x-frame-options"]).toBe("SAMEORIGIN")
        expect(res.headers()["cache-control"]).toContain("immutable")
    })

    test("every draw.io internal the bridge uses exists (upgrade canary)", async ({
        page,
    }) => {
        await openApp(page)
        const missing = await page.evaluate(() => {
            const w = (document.querySelector("iframe") as HTMLIFrameElement)
                .contentWindow as any
            const ui = w.__adioEditorUi
            const checks: Record<string, unknown> = {
                "EditorUi.replaceDiagramData": ui.replaceDiagramData,
                "EditorUi.getXmlFileData": ui.getXmlFileData,
                "EditorUi.getPageById": ui.getPageById,
                "EditorUi.selectPage": ui.selectPage,
                "EditorUi.undo": ui.undo,
                "EditorUi.redo": ui.redo,
                "EditorUi.updateActionStates":
                    w.EditorUi.prototype.updateActionStates,
                "EditorUi.fileLoaded": w.EditorUi.prototype.fileLoaded,
                ReplaceDiagram: w.ReplaceDiagram,
                "ReplaceDiagram.execute": w.ReplaceDiagram?.prototype?.execute,
                "mxUtils.parseXml": w.mxUtils?.parseXml,
                "mxUtils.getXml": w.mxUtils?.getXml,
                "Graph.decompress": w.Graph?.decompress,
                "undoManager.undoableEditHappened":
                    ui.editor.undoManager.undoableEditHappened,
                "graph.isEnabled": ui.editor.graph.isEnabled,
                "view.scaleAndTranslate":
                    ui.editor.graph.view.scaleAndTranslate,
            }
            return Object.entries(checks)
                .filter(([, v]) => typeof v !== "function")
                .map(([k]) => k)
        })
        expect(missing).toEqual([])
    })
})
