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
| `generate_diagram` | `description` | Complete `.drawio` (mxfile) document |
| `edit_diagram` | `current_xml`, `change` | Updated `.drawio` document |

Both tools return the full `.drawio` XML inline, plus a rendered-preview link
when `APP_BASE_URL` is set. Generation of a complex diagram can take several
minutes; the endpoint streams MCP progress notifications throughout so clients
and proxies keep the connection open.

Ask the agent something like *"draw an AWS three-tier architecture with an ALB, an EC2 auto-scaling group and RDS Multi-AZ"*, then save the returned XML as a `.drawio` file and open it in draw.io.

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
  "notes": [],
  "viewUrl": "https://your-deployment.example.com/#R..."
}
```

- `xml` — bare `<mxCell>` elements
- `mxfile` — a complete document that draw.io can open directly
- `notes` — XML auto-fixes that were applied, if any
- `viewUrl` — link that opens the diagram rendered in this app (only present when `APP_BASE_URL` is configured)

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
