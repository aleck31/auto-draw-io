import { NextResponse } from "next/server"
import { getDiagram } from "@/lib/diagram-store"

export const runtime = "nodejs"

/**
 * Fetch a generated diagram by id.
 *
 * Used by the app when opening a share link (`/?d=<id>`) and by agents that want
 * the raw XML. No access code is required: the id is a 128-bit random token, so
 * the URL itself is the capability - requiring a header would break opening the
 * link in a browser.
 *
 * `?format=xml` returns the raw document (suitable for saving as .drawio),
 * otherwise a JSON envelope is returned.
 */
export async function GET(
    req: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    const { id } = await params
    const xml = getDiagram(id)

    if (!xml) {
        return NextResponse.json(
            {
                error: "Diagram not found. Links expire after 30 days and are cleared when the server restarts.",
            },
            { status: 404 },
        )
    }

    const format = new URL(req.url).searchParams.get("format")
    if (format === "xml") {
        return new Response(xml, {
            headers: {
                "Content-Type": "application/xml; charset=utf-8",
                "Content-Disposition": `inline; filename="diagram-${id}.drawio"`,
            },
        })
    }

    return NextResponse.json({ id, mxfile: xml })
}
