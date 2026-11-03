import { getDiagramAt } from "@/lib/diagram-store"
import drawioVersion from "@/scripts/drawio-version.json"

export const runtime = "nodejs"

/**
 * Minimal render-only page for a stored diagram: `/render/<id>`.
 *
 * Contains just the diagram - no app chrome - so it is suitable for:
 *  - agents with a headless browser: open the URL and screenshot to get a PNG
 *  - humans who only want to look at the diagram
 *
 * `?v=<version>` shows an earlier version; the first page of the file is shown.
 *
 * The draw.io viewer script comes from the bundled draw.io on this origin,
 * so no deployment needs to reach diagrams.net.
 */

function escapeAttribute(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/"/g, "&quot;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
}

export async function GET(
    req: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    const { id } = await params
    const v = new URL(req.url).searchParams.get("v")
    const version = v && /^\d+$/.test(v) ? Number(v) : undefined
    const xml = getDiagramAt(id, version)?.xml

    if (!xml) {
        return new Response(
            '<!doctype html><meta charset=utf-8><title>Diagram not found</title><body style="font:14px system-ui;padding:2rem">This diagram link has expired or is no longer available. Diagrams expire 30 days after their last change.',
            {
                status: 404,
                headers: { "Content-Type": "text/html; charset=utf-8" },
            },
        )
    }

    const viewerScript = `${process.env.AUTO_BASE_PATH || ""}/drawio/${drawioVersion.version}/js/viewer-static.min.js`

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
