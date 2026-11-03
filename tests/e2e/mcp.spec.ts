import fs from "node:fs"
import path from "node:path"
import { type APIRequestContext, expect, test } from "@playwright/test"
import { E2E_STORE_DIR } from "../../playwright.config"

/**
 * The MCP tools an agent uses to draw the XML itself: no model is involved,
 * so they run against the real server, its file store and its renderer.
 */

type Content = { type: string; text?: string; data?: string }
type ToolResult = { content: Content[]; isError?: boolean }

async function callTool(
    request: APIRequestContext,
    name: string,
    args: Record<string, unknown>,
): Promise<ToolResult> {
    const response = await request.post("/api/mcp", {
        headers: {
            accept: "application/json, text/event-stream",
            "mcp-protocol-version": "2025-06-18",
        },
        data: {
            jsonrpc: "2.0",
            id: 1,
            method: "tools/call",
            params: { name, arguments: args },
        },
    })
    expect(response.ok()).toBe(true)
    // Server-sent events; the response is the message with our id
    const message = (await response.text())
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => JSON.parse(line.slice(5)))
        .find((m) => m.id === 1)
    expect(message?.error).toBeUndefined()
    return message.result
}

const textOf = (result: ToolResult) =>
    result.content
        .filter((c) => c.type === "text")
        .map((c) => c.text)
        .join("\n")

const idOf = (result: ToolResult) =>
    /diagram ([A-Za-z0-9_-]{22}), version/.exec(textOf(result))?.[1] ?? ""

const cell = (id: string, label: string, x: number) =>
    `<mxCell id="${id}" value="${label}" style="rounded=1;whiteSpace=wrap;html=1;" vertex="1" parent="1"><mxGeometry x="${x}" y="40" width="120" height="60" as="geometry"/></mxCell>`

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
        expect(textOf(created)).toContain("version 1 (5 cells)")
        // Kept on disk, so it survives a restart
        expect(fs.existsSync(path.join(E2E_STORE_DIR, `${id}.json`))).toBe(true)

        // A failing operation changes nothing, the good ones included
        const rejected = await callTool(request, "edit_cells", {
            diagram_id: id,
            operations: [
                {
                    operation: "add",
                    cell_id: "cache",
                    new_xml: cell("cache", "Cache", 480),
                },
                {
                    operation: "update",
                    cell_id: "nope",
                    new_xml: cell("nope", "x", 0),
                },
            ],
        })
        expect(rejected.isError).toBe(true)
        expect(textOf(rejected)).toContain("still version 1")
        expect(textOf(rejected)).toContain('id="nope" not found')

        const edited = await callTool(request, "edit_cells", {
            diagram_id: id,
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
        expect(textOf(edited)).toContain("version 2")
        const image = edited.content.find((c) => c.type === "image")
        expect(image?.data?.length).toBeGreaterThan(500)
        expect(textOf(edited)).toContain("fix them with edit_cells")

        // Deleting "web" took its connector with it
        const read = textOf(
            await callTool(request, "get_diagram", { diagram_id: id }),
        )
        expect(read).toContain("version 2 (current)")
        expect(read).toContain('value="RDS"')
        expect(read).not.toContain('id="web"')
        expect(read).not.toContain('id="e1"')

        const restored = await callTool(request, "restore_version", {
            diagram_id: id,
            version: 1,
        })
        expect(textOf(restored)).toContain("version 3")
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
            operations: [
                {
                    operation: "add",
                    cell_id: "b",
                    new_xml: cell("b", "B", 260),
                },
            ],
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
})
