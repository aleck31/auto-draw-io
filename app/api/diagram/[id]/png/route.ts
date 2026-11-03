import { checkAgentAccess } from "@/lib/agent-diagram"
import { RenderUnavailableError, renderDiagramPng } from "@/lib/diagram-render"
import { getDiagramAt } from "@/lib/diagram-store"

export const runtime = "nodejs"

/**
 * PNG of a stored diagram, rendered on the server: `GET /api/diagram/<id>/png`.
 * Needs the access code (x-access-code), since every request runs a browser.
 *
 * `?v=<version>` renders an earlier version; `?scale=1|2|3` (default 2) sets
 * the pixel density. The first page of the file is rendered.
 */
export async function GET(
    req: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    if (!checkAgentAccess(req)) {
        return Response.json(
            { error: "Invalid or missing access code" },
            { status: 401 },
        )
    }
    const { id } = await params
    const query = new URL(req.url).searchParams
    const v = query.get("v")
    const version = v && /^\d+$/.test(v) ? Number(v) : undefined
    const scale = Math.min(3, Math.max(1, Number(query.get("scale")) || 2))

    const stored = getDiagramAt(id, version)
    if (!stored) {
        return Response.json(
            {
                error: "Diagram not found: diagrams expire 30 days after their last change.",
            },
            { status: 404 },
        )
    }
    try {
        const png = await renderDiagramPng(id, { version, scale })
        return new Response(new Uint8Array(png), {
            headers: {
                "Content-Type": "image/png",
                "Content-Disposition": `inline; filename="diagram-${id}${version === undefined ? "" : `-v${version}`}.png"`,
                // A version never changes; the current one does
                "Cache-Control":
                    version === undefined
                        ? "private, no-store"
                        : "private, max-age=31536000, immutable",
            },
        })
    } catch (error) {
        console.error("[diagram png]", error)
        const unavailable = error instanceof RenderUnavailableError
        return Response.json(
            {
                error: unavailable
                    ? "PNG rendering is not available on this server."
                    : "Rendering the diagram failed.",
            },
            { status: unavailable ? 503 : 500 },
        )
    }
}
