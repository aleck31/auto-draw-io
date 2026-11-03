import { type APIRequestContext, expect } from "@playwright/test"

/** Calling the MCP endpoint and reading its results, for the tests */

export type Content = { type: string; text?: string; data?: string }
export type ToolResult = { content: Content[]; isError?: boolean }

export async function callTool(
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

export const textOf = (result: ToolResult) =>
    result.content
        .filter((c) => c.type === "text")
        .map((c) => c.text)
        .join("\n")

export const idOf = (result: ToolResult) =>
    /diagram ([A-Za-z0-9_-]{22})/.exec(textOf(result))?.[1] ?? ""

export const revisionOf = (result: ToolResult) =>
    Number(/revision (\d+)/.exec(textOf(result))?.[1])

export const cell = (id: string, label: string, x: number) =>
    `<mxCell id="${id}" value="${label}" style="rounded=1;whiteSpace=wrap;html=1;" vertex="1" parent="1"><mxGeometry x="${x}" y="40" width="120" height="60" as="geometry"/></mxCell>`

export const add = (id: string, label: string, x: number) => ({
    operation: "add",
    cell_id: id,
    new_xml: cell(id, label, x),
})
