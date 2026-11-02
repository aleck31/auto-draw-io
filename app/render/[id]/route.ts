import { getDiagram } from "@/lib/diagram-store"
import drawioVersion from "@/scripts/drawio-version.json"

export const runtime = "nodejs"

/**
 * Minimal render-only page for a stored diagram: `/render/<id>`.
 *
 * Contains just the diagram - no app chrome - so it is suitable for:
 *  - agents with a headless browser: open the URL and screenshot to get a PNG
 *  - humans who only want to look at the diagram
 *
 * The draw.io viewer script comes from the bundled draw.io on this origin,
 * or from EMBED_DRAWIO_BASE_URL when an external draw.io is configured, so no
 * deployment needs to reach diagrams.net.
 */

function escapeAttribute(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/"/g, "&quot;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
}

export async function GET(
    _req: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    const { id } = await params
    const xml = getDiagram(id)

    if (!xml) {
        return new Response(
            '<!doctype html><meta charset=utf-8><title>Diagram not found</title><body style="font:14px system-ui;padding:2rem">This diagram link has expired or is no longer available. Links last 30 days and are cleared when the server restarts.',
            {
                status: 404,
                headers: { "Content-Type": "text/html; charset=utf-8" },
            },
        )
    }

    const external = (process.env.EMBED_DRAWIO_BASE_URL || "").replace(
        /\/$/,
        "",
    )
    const viewerScript = external
        ? `${external.startsWith("http") ? external : `https://${external}`}/js/viewer-static.min.js`
        : `${process.env.AUTO_BASE_PATH || ""}/drawio/${drawioVersion.version}/js/viewer-static.min.js`

    const config = escapeAttribute(
        JSON.stringify({
            xml,
            zoom: 1,
            resize: true,
            nav: false,
            toolbar: null,
        }),
    )

    const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Diagram ${id}</title>
<style>html,body{margin:0;padding:0;background:#fff}
.mxgraph{max-width:none!important}</style>
</head><body>
<div class="mxgraph" data-mxgraph="${config}"></div>
<script src="${viewerScript}"></script>
</body></html>`

    return new Response(html, {
        headers: {
            "Content-Type": "text/html; charset=utf-8",
            // Diagrams are immutable once generated.
            "Cache-Control": "private, max-age=3600",
        },
    })
}
