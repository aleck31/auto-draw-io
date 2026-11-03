# Agent Access

AI agents can call this project to generate draw.io diagrams in two ways. Model access, system prompts, icon libraries and XML validation all stay server-side, so agents need no model API key of their own.

## Option 1: MCP (recommended)

The server has a built-in MCP endpoint (Streamable HTTP). Agents only need a URL and an access code — **no local install or build**.

```json
{
  "mcpServers": {
    "auto-drawio": {
      "url": "https://your-deployment.example.com/api/mcp",
      "headers": { "x-access-code": "your-code" }
    }
  }
}
```

Omit `headers` if the deployment does not set `ACCESS_CODE`. Works with Claude Desktop, Cursor, Cline, Claude Code and other clients that support MCP over HTTP (config file location differs per client).

The endpoint is stateless (no session stickiness required), so it runs fine behind a load balancer or on serverless platforms.

### Available tools

| Tool | Arguments | Returns |
|------|-----------|---------|
| `generate_diagram` | `description` | Compact summary: diagram id + links (view/render). No inline XML - fetch it with `get_diagram_xml` if needed. |
| `edit_diagram` | `change` + `diagram_id` (or `current_xml`) | New diagram id and links |
| `get_diagram_xml` | `diagram_id` | The full `.drawio` XML |

Responses are deliberately compact (a few hundred bytes): a diagram id, a link
to open/edit it, and a render-only link. The XML is not inlined - fetch it with
`get_diagram_xml` only when you need the markup. To modify a diagram, pass its
`diagram_id` to `edit_diagram`; you never have to move the XML through the
conversation.

Generation of a complex diagram can take several minutes; the endpoint streams
MCP progress notifications throughout, so clients and proxies keep the
connection open.

### Getting a PNG

`/render/<id>` serves the diagram on its own, with no app UI, so an agent with a
headless browser can screenshot it:

```js
const page = await browser.newPage()
await page.goto(`${BASE}/render/${diagramId}`, { waitUntil: "networkidle" })
const el = await page.waitForSelector(".mxgraph svg, svg")
await el.screenshot({ path: "diagram.png" })
```

The viewer script for that page comes from the draw.io bundled with the app, so no deployment needs to reach diagrams.net.

For a vector SVG, open the diagram in the app (`/?d=<id>`) and use draw.io's own
SVG export - it handles label bounds and namespaces correctly, which a naive DOM
extraction does not.

Ask the agent something like *"draw an AWS three-tier architecture with an ALB, an EC2 auto-scaling group and RDS Multi-AZ"*. The response gives you a link to open/edit it in the app, and another to render it for a screenshot.

## Option 2: HTTP API

Agents that do not speak MCP can call the REST endpoint directly:

```bash
curl -X POST https://your-deployment.example.com/api/agent/diagram \
  -H "Content-Type: application/json" \
  -H "x-access-code: your-code" \
  -d '{"prompt":"AWS: users -> CloudFront -> ALB -> EC2 -> RDS"}'
```

Request fields:

| Field | Required | Description |
|-------|----------|-------------|
| `prompt` | yes | Natural-language description of the diagram |
| `currentXml` | no | Existing diagram XML to modify (mxfile or bare mxCells) |
| `modelId` | no | Server model to use; must be listed in `AI_MODELS` |

Response:

```json
{
  "xml": "<mxCell .../>...",
  "mxfile": "<mxfile>...</mxfile>",
  "id": "H9Xq554svFMyXt614WN4qg",
  "cellCount": 12,
  "notes": [],
  "viewUrl": "https://your-deployment.example.com/?d=<id>",
  "renderUrl": "https://your-deployment.example.com/render/<id>",
  "durableViewUrl": "https://your-deployment.example.com/#R..."
}
```

- `xml` — bare `<mxCell>` elements
- `mxfile` — a complete document that draw.io can open directly
- `id` — diagram id; use it with `/api/diagram/<id>` or the MCP tools
- `cellCount` — number of cells, for a quick sanity check
- `notes` — XML auto-fixes that were applied, if any
- `viewUrl` — opens the diagram in the app for viewing/editing
- `renderUrl` — render-only page, suitable for screenshotting
- `durableViewUrl` — self-contained link with the diagram in the URL fragment; longer, but keeps working after the store expires or the server restarts

The `viewUrl`/`renderUrl` links are backed by an in-memory store: entries last 30
days, are capped at 500, and are cleared when the server restarts. Ids are
128-bit random tokens, so the links work without an access code.

Fetch a stored diagram directly with `GET /api/diagram/<id>` (add `?format=xml`
for the raw document).

### Rendered preview link

Set `APP_BASE_URL` on the deployment to have responses include a `viewUrl`. The
diagram is encoded in the URL fragment, so nothing is stored server-side and the
link works immediately. Opening it loads the diagram into the editor, where it
can be viewed, edited, or exported as PNG/SVG.

Note: the fragment is decoded in the browser, so an agent cannot download an
image from this URL - it is for a human to open. Agents receive the diagram as
XML.

## Tips

The more specific the description, the better the result. State which components exist and how they connect, for example:
`AWS: users -> CloudFront -> ALB -> EC2 in a private subnet -> RDS Multi-AZ`
