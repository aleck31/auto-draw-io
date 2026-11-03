import fs from "node:fs"
import path from "node:path"
import { expect, test } from "@playwright/test"
import { canvasNoteText, withImagesHidden } from "@/lib/canvas-note"
import {
    hideImageData,
    restoreImageData,
    restoreOperationImages,
} from "@/lib/embedded-images"
import {
    mockChat,
    openApp,
    seedDiagram,
    sendAndWait,
    toolCallTurn,
} from "./helpers"
import { add, callTool, idOf, revisionOf, textOf } from "./mcp-helpers"

/**
 * Pictures embedded in a diagram reach the model as short references and
 * come back whole in what it draws.
 */

const PICTURE = fs
    .readFileSync(path.join(process.cwd(), "public", "icon-192.png"))
    .toString("base64")

const pictureCell = (id: string, x: number) =>
    `<mxCell id="${id}" value="" style="shape=image;aspect=fixed;image=data:image/png,${PICTURE};" vertex="1" parent="1"><mxGeometry x="${x}" y="40" width="96" height="96" as="geometry"/></mxCell>`

const page = (cells: string) =>
    `<mxfile><diagram name="Page-1" id="page-1"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${cells}</root></mxGraphModel></diagram></mxfile>`

const refOf = (xml: string) =>
    /data:image\/png,(embedded-image-[0-9a-z]+)/.exec(
        hideImageData(xml),
    )?.[1] ?? ""

test.describe("pictures embedded in a diagram", () => {
    test("are references to the model and come back whole", () => {
        const xml = page(pictureCell("logo", 40))
        const shown = hideImageData(xml)
        expect(shown.length).toBeLessThan(xml.length - PICTURE.length + 100)
        expect(shown).not.toContain(PICTURE.slice(0, 100))
        // The same picture is always the same reference
        expect(hideImageData(page(pictureCell("other", 300)))).toContain(
            refOf(xml),
        )
        expect(restoreImageData(shown, xml)).toBe(xml)
        // Short data, and a reference with no source, stay as written
        const tiny = 'image=data:image/png,iVBORw0KGgo="'
        expect(hideImageData(tiny)).toBe(tiny)
        expect(restoreImageData(shown)).toBe(shown)
        const [op] = restoreOperationImages(
            [
                {
                    operation: "update",
                    cell_id: "logo",
                    new_xml: pictureCell("logo", 80).replace(
                        PICTURE,
                        refOf(xml),
                    ),
                },
            ],
            xml,
        )
        expect(op.new_xml).toContain(PICTURE)
    })

    test("the chat's canvas note and earlier tool calls carry references", () => {
        const xml = page(pictureCell("logo", 40))
        const note = canvasNoteText({ xml })
        expect(note).not.toContain(PICTURE.slice(0, 100))
        expect(note).toContain(refOf(xml))
        expect(note).toContain("Keep a reference exactly as written")
        // A diagram without pictures gets no note about them
        expect(
            canvasNoteText({
                xml: page(
                    '<mxCell id="a" vertex="1" parent="1"><mxGeometry as="geometry"/></mxCell>',
                ),
            }),
        ).not.toContain("embedded-image")

        const [assistant] = withImagesHidden([
            {
                role: "assistant",
                parts: [
                    {
                        type: "tool-display_diagram",
                        input: { xml: pictureCell("logo", 40) },
                        output: "ok",
                    },
                    // A screenshot is an image for the model to see: left alone
                    {
                        type: "tool-edit_diagram",
                        input: { operations: [] },
                        output: {
                            message: "m",
                            image: `data:image/png;base64,${PICTURE}`,
                        },
                    },
                ],
            },
        ])
        const parts = assistant.parts as {
            input?: { xml?: string }
            output?: { image?: string }
        }[]
        expect(parts[0].input?.xml).not.toContain(PICTURE.slice(0, 100))
        expect(parts[1].output?.image).toContain(PICTURE)
    })

    test("the model's drawing with a reference shows the picture on the canvas", async ({
        page: browser,
    }) => {
        const canvas = page(pictureCell("logo", 40))
        await seedDiagram(browser, canvas)
        // The model redraws the page and keeps the picture by its reference
        const redrawn = `${pictureCell("logo", 200).replace(PICTURE, refOf(canvas))}<mxCell id="t" value="Caption" vertex="1" parent="1"><mxGeometry x="200" y="160" width="96" height="30" as="geometry"/></mxCell>`
        await mockChat(browser, [
            toolCallTurn("display_diagram", { xml: redrawn }, { pieces: 6 }),
        ])
        await openApp(browser)
        await sendAndWait(browser, "add a caption under the logo")
        const style = await browser.evaluate(() => {
            const w = (document.querySelector("iframe") as HTMLIFrameElement)
                .contentWindow as any
            return (
                w.__adioEditorUi.editor.graph.model.getCell("logo")?.style ?? ""
            )
        })
        expect(style).toContain(PICTURE)
        expect(style).not.toContain("embedded-image-")
    })

    test("MCP shows references and puts the pictures back", async ({
        request,
    }) => {
        const created = await callTool(request, "create_diagram", {
            xml: pictureCell("logo", 40),
        })
        const id = idOf(created)
        const read = await callTool(request, "get_diagram", { diagram_id: id })
        expect(textOf(read)).not.toContain(PICTURE.slice(0, 100))
        expect(textOf(read)).toContain("Keep a reference exactly as written")
        const ref =
            /data:image\/png,(embedded-image-[0-9a-z]+)/.exec(
                textOf(read),
            )?.[1] ?? ""
        expect(ref).not.toBe("")

        // An edit by cell that rewrites the picture cell with its reference
        await callTool(request, "edit_cells", {
            diagram_id: id,
            base_revision: revisionOf(read),
            operations: [
                {
                    operation: "update",
                    cell_id: "logo",
                    new_xml: pictureCell("logo", 120).replace(PICTURE, ref),
                },
                add("cap", "Caption", 120),
            ],
        })
        const stored = textOf(
            await callTool(request, "get_diagram_xml", { diagram_id: id }),
        )
        expect(stored).toContain(PICTURE)
        expect(stored).not.toContain("embedded-image-")

        // A new diagram that copies the cell gets the picture from the stored one
        const copy = await callTool(request, "create_diagram", {
            xml: pictureCell("logo", 40).replace(PICTURE, ref),
        })
        const copied = textOf(
            await callTool(request, "get_diagram_xml", {
                diagram_id: idOf(copy),
            }),
        )
        expect(copied).toContain(PICTURE)
    })
})
