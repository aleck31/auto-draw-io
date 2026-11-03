import { spawn } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import {
    type APIRequestContext,
    expect,
    request as newRequest,
    test,
} from "@playwright/test"
import { E2E_STORE_DIR } from "../../playwright.config"
import { add, callTool, cell, idOf, revisionOf, textOf } from "./mcp-helpers"

/**
 * The MCP tools an agent uses to draw the XML itself, and the browser's saves
 * of the same diagrams: no model is involved, so they run against the real
 * server, its file store and its renderer.
 */

const EDGE =
    '<mxCell id="e1" style="edgeStyle=orthogonalEdgeStyle;endArrow=classic;" edge="1" parent="1" source="web" target="db"><mxGeometry relative="1" as="geometry"/></mxCell>'

test.describe("MCP tools for agents that write the XML", () => {
    test("create, edit by cell, read, restore and render a diagram", async ({
        request,
    }) => {
        const created = await callTool(request, "create_diagram", {
            xml: cell("web", "Web", 40) + cell("db", "Database", 260) + EDGE,
        })
        expect(created.isError).toBeFalsy()
        const id = idOf(created)
        expect(textOf(created)).toContain("version 1, revision 1 (5 cells)")
        // Kept on disk, so it survives a restart
        expect(fs.existsSync(path.join(E2E_STORE_DIR, `${id}.json`))).toBe(true)

        // A failing operation changes nothing, the good ones included
        const rejected = await callTool(request, "edit_cells", {
            diagram_id: id,
            base_revision: 1,
            operations: [
                add("cache", "Cache", 480),
                {
                    operation: "update",
                    cell_id: "nope",
                    new_xml: cell("nope", "x", 0),
                },
            ],
        })
        expect(rejected.isError).toBe(true)
        expect(textOf(rejected)).toContain("still at revision 1")
        expect(textOf(rejected)).toContain('id="nope" not found')

        const edited = await callTool(request, "edit_cells", {
            diagram_id: id,
            base_revision: 1,
            operations: [
                {
                    operation: "update",
                    cell_id: "db",
                    new_xml: cell("db", "RDS", 260),
                },
                { operation: "delete", cell_id: "web" },
            ],
            screenshot: true,
        })
        expect(edited.isError).toBeFalsy()
        expect(idOf(edited)).toBe(id)
        expect(textOf(edited)).toContain("version 2, revision 2")
        const image = edited.content.find((c) => c.type === "image")
        expect(image?.data?.length).toBeGreaterThan(500)
        expect(textOf(edited)).toContain("fix them with edit_cells")

        // Deleting "web" took its connector with it
        const read = textOf(
            await callTool(request, "get_diagram", { diagram_id: id }),
        )
        expect(read).toContain("revision 2: version 2.")
        expect(read).toContain('value="RDS"')
        expect(read).not.toContain('id="web"')
        expect(read).not.toContain('id="e1"')

        const restored = await callTool(request, "restore_version", {
            diagram_id: id,
            version: 1,
        })
        expect(textOf(restored)).toContain("version 3, revision 3")
        const history = textOf(
            await callTool(request, "get_diagram", { diagram_id: id }),
        )
        expect(history).toContain("1 (agent), 2 (agent), 3 (restore)")
        expect(history).toContain('value="Web"')

        const png = await request.get(`/api/diagram/${id}/png?v=2`)
        expect(png.headers()["content-type"]).toBe("image/png")
        expect((await png.body()).subarray(1, 4).toString()).toBe("PNG")
        expect(png.headers()["cache-control"]).toContain("immutable")
    })

    test("edit_cells changes the first page and keeps the others", async ({
        request,
    }) => {
        const page = (cells: string) =>
            `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${cells}</root></mxGraphModel>`
        const file = `<mxfile><diagram name="Overview" id="p1">${page(cell("a", "A", 40))}</diagram><diagram name="Network" id="p2">${page(cell("n", "KEEP", 40))}</diagram></mxfile>`
        const id = idOf(
            await callTool(request, "create_diagram", { xml: file }),
        )

        await callTool(request, "edit_cells", {
            diagram_id: id,
            base_revision: 1,
            operations: [add("b", "B", 260)],
        })
        const read = textOf(
            await callTool(request, "get_diagram", { diagram_id: id }),
        )
        expect(read).toContain('value="B"')
        expect(read).toContain('2 pages ("Overview", "Network")')
        const whole = textOf(
            await callTool(request, "get_diagram_xml", { diagram_id: id }),
        )
        expect(whole).toContain('value="KEEP"')
        expect(whole).toContain('value="B"')
    })

    test("invalid XML and unknown ids are reported, not stored", async ({
        request,
    }) => {
        const nested = await callTool(request, "create_diagram", {
            xml: '<mxCell id="a" vertex="1" parent="1"><mxCell id="b" vertex="1" parent="1"/><mxGeometry as="geometry"/></mxCell>',
        })
        expect(nested.isError).toBe(true)
        expect(textOf(nested)).toContain("nested mxCell")

        const missing = await callTool(request, "get_diagram", {
            diagram_id: "AAAAAAAAAAAAAAAAAAAAAA",
        })
        expect(missing.isError).toBe(true)
        expect(textOf(missing)).toContain("expire 30 days")
        // Not a diagram id: never touches the file system
        const traversal = await request.get(
            "/api/diagram/..%2F..%2Fetc%2Fpasswd",
        )
        expect(traversal.status()).toBe(404)
    })

    test("the drawing guide speaks of the MCP tools", async ({ request }) => {
        const guide = textOf(await callTool(request, "get_drawing_guide", {}))
        expect(guide).toContain("create_diagram")
        expect(guide).toContain("edit_cells")
        expect(guide).not.toContain("display_diagram")
        expect(guide).not.toContain("To clear the")
    })

    test("browser saves: revisions, conflicts, retries and no-op saves", async ({
        request,
    }) => {
        const id = idOf(
            await callTool(request, "create_diagram", {
                xml: cell("web", "Web", 40),
            }),
        )
        const put = (xml: string, baseRevision: number) =>
            request.put(`/api/diagram/${id}`, { data: { xml, baseRevision } })
        const { mxfile, revision } = await (
            await request.get(`/api/diagram/${id}`)
        ).json()
        expect(revision).toBe(1)

        // The same diagram written differently (page id, attribute order) is no edit
        const rewritten = mxfile
            .replace('id="page-1"', 'id="other-id"')
            .replace(
                'value="Web" style="rounded=1;whiteSpace=wrap;html=1;"',
                'style="rounded=1;whiteSpace=wrap;html=1;" value="Web"',
            )
        expect(rewritten).not.toBe(mxfile)
        expect(await (await put(rewritten, 1)).json()).toEqual({
            revision: 1,
            unchanged: true,
        })

        const edited = mxfile.replace('value="Web"', 'value="Web by hand"')
        expect(await (await put(edited, 1)).json()).toEqual({
            revision: 2,
            unchanged: false,
        })
        // A retry of a save whose response was lost is no conflict
        expect((await put(edited, 1)).status()).toBe(200)

        // A save based on an old revision is refused with the current diagram
        const stale = await put(
            mxfile.replace('value="Web"', 'value="Other"'),
            1,
        )
        expect(stale.status()).toBe(409)
        expect((await stale.json()).revision).toBe(2)

        // So is the agent's edit based on revision 1
        const agentStale = await callTool(request, "edit_cells", {
            diagram_id: id,
            base_revision: 1,
            operations: [add("db", "DB", 260)],
        })
        expect(agentStale.isError).toBe(true)
        expect(textOf(agentStale)).toContain(
            "edited by the user in the browser",
        )

        // get_diagram shows the user's edit; an edit based on it goes through
        const current = await callTool(request, "get_diagram", {
            diagram_id: id,
        })
        expect(textOf(current)).toContain("Web by hand")
        expect(textOf(current)).toContain("browser edits (not yet a version)")
        const agentEdit = await callTool(request, "edit_cells", {
            diagram_id: id,
            base_revision: revisionOf(current),
            operations: [add("db", "DB", 260)],
        })
        // The browser edit it replaced became version 2, the agent's version 3
        expect(textOf(agentEdit)).toContain("version 3, revision 3")
        expect(textOf(agentEdit)).toContain("kept as version 2")
        const history = textOf(
            await callTool(request, "get_diagram", { diagram_id: id }),
        )
        expect(history).toContain("1 (agent), 2 (user), 3 (agent)")
        expect(history).toContain("Web by hand")

        expect((await put("<mxGraphModel/>", 3)).status()).toBe(400)
        const unknown = await request.put(
            "/api/diagram/AAAAAAAAAAAAAAAAAAAAAA",
            { data: { xml: mxfile, baseRevision: 1 } },
        )
        expect(unknown.status()).toBe(404)
    })

    test("two servers on one store directory lose no write", async ({
        request,
    }) => {
        test.setTimeout(120_000)
        // A second instance on the same directory, as in a rolling update
        const port = 3301
        const server = spawn(process.execPath, ["server.js"], {
            cwd: path.join(process.cwd(), ".next", "standalone"),
            env: {
                ...process.env,
                PORT: String(port),
                DIAGRAM_STORE_DIR: E2E_STORE_DIR,
                ACCESS_CODE: "",
            },
            stdio: "ignore",
        })
        const other = await newRequest.newContext({
            baseURL: `http://localhost:${port}`,
        })
        try {
            await expect
                .poll(
                    async () =>
                        (await other.get("/").catch(() => null))?.ok() ?? false,
                    { timeout: 30_000 },
                )
                .toBe(true)
            const id = idOf(
                await callTool(request, "create_diagram", {
                    xml: cell("c0", "0", 0),
                }),
            )

            // Agents on both servers add cells, each based on the revision of
            // its own last result; refused when the other wrote meanwhile, they
            // reread and retry
            let refused = 0
            const addCells = async (
                client: APIRequestContext,
                prefix: string,
            ) => {
                let revision = 1
                for (let i = 0; i < 8; i++) {
                    for (;;) {
                        const result = await callTool(client, "edit_cells", {
                            diagram_id: id,
                            base_revision: revision,
                            operations: [
                                add(`${prefix}${i}`, `${prefix}${i}`, i * 10),
                            ],
                        })
                        if (!result.isError) {
                            revision = revisionOf(result)
                            break
                        }
                        expect(textOf(result)).toContain(
                            "changed since revision",
                        )
                        refused++
                        revision = revisionOf(
                            await callTool(client, "get_diagram", {
                                diagram_id: id,
                            }),
                        )
                    }
                }
            }
            await Promise.all([addCells(request, "a"), addCells(other, "b")])
            const xml = textOf(
                await callTool(request, "get_diagram_xml", { diagram_id: id }),
            )
            for (const prefix of ["a", "b"]) {
                for (let i = 0; i < 8; i++) {
                    expect(xml).toContain(`id="${prefix}${i}"`)
                }
            }
            const { revision } = await (
                await request.get(`/api/diagram/${id}`)
            ).json()
            expect(revision).toBe(17)
            expect(refused).toBeGreaterThan(0)
        } finally {
            await other.dispose()
            server.kill()
        }
    })
})
