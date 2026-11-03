import { NextResponse } from "next/server"
import { checkAgentAccess, validDiagramXml } from "@/lib/agent-diagram"
import { getCurrentDiagram, saveUserEdit } from "@/lib/diagram-store"

export const runtime = "nodejs"

/** Larger documents are refused; agent diagrams are a few to some 100 KB */
const MAX_XML_BYTES = 1_000_000

const NOT_FOUND = {
    error: "Diagram not found: diagrams expire 30 days after their last change.",
}

/**
 * A stored diagram: `GET` reads it, `PUT` saves the browser's edits (/d/<id>).
 *
 * GET needs no access code: the id is a 128-bit random token, so the URL itself
 * is the capability. `?format=xml` returns the raw document (a .drawio file),
 * otherwise `{ id, mxfile, revision }`.
 *
 * PUT `{ xml, baseRevision }` needs the access code when the deployment sets
 * one, as the other write endpoints do. It replaces the current document
 * without adding a version (lib/diagram-store.ts), and answers 409 with the
 * current diagram when it changed after baseRevision.
 */
export async function GET(
    req: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    const { id } = await params
    const current = getCurrentDiagram(id)
    if (!current) return NextResponse.json(NOT_FOUND, { status: 404 })

    const headers = { "Cache-Control": "no-store" }
    const format = new URL(req.url).searchParams.get("format")
    if (format === "xml") {
        return new Response(current.xml, {
            headers: {
                ...headers,
                "Content-Type": "application/xml; charset=utf-8",
                "Content-Disposition": `inline; filename="diagram-${id}.drawio"`,
            },
        })
    }
    return NextResponse.json(
        { id, mxfile: current.xml, revision: current.revision },
        { headers },
    )
}

export async function PUT(
    req: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    if (!checkAgentAccess(req)) {
        return NextResponse.json(
            { error: "Invalid or missing access code" },
            { status: 401 },
        )
    }
    const { id } = await params
    const body = await req.text()
    if (Buffer.byteLength(body) > MAX_XML_BYTES) {
        return NextResponse.json(
            { error: "The diagram is too large." },
            { status: 413 },
        )
    }
    let xml: unknown
    let baseRevision: unknown
    try {
        ;({ xml, baseRevision } = JSON.parse(body))
    } catch {
        return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
    }
    if (
        typeof xml !== "string" ||
        !xml.trim().startsWith("<mxfile") ||
        !Number.isInteger(baseRevision)
    ) {
        return NextResponse.json(
            { error: "Send { xml: <mxfile>, baseRevision: number }" },
            { status: 400 },
        )
    }
    try {
        validDiagramXml(xml)
    } catch (error) {
        return NextResponse.json(
            { error: (error as Error).message },
            { status: 400 },
        )
    }

    const saved = saveUserEdit(id, xml, baseRevision as number)
    if (saved.ok) {
        return NextResponse.json({
            revision: saved.revision,
            unchanged: saved.unchanged,
        })
    }
    if (saved.reason === "not-found") {
        return NextResponse.json(NOT_FOUND, { status: 404 })
    }
    return NextResponse.json(
        {
            error: "The diagram changed since your copy.",
            revision: saved.current.revision,
            mxfile: saved.current.xml,
        },
        { status: 409 },
    )
}
