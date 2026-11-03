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

Two ways to draw, on the same stored diagrams and cell ids:

- **The agent writes the XML** (answers in about a second): the server validates, stores, versions and renders it.
- **The server's model draws** from a description (can take minutes): `generate_diagram` and `edit_diagram`.

| Tool | Arguments | Returns |
|------|-----------|---------|
| `get_drawing_guide` | | The XML format and the layout and connector-routing rules |
| `get_shape_library` | `library` | Exact style names of an icon library (`aws4`, `kubernetes`, ...) |
| `create_diagram` | `xml`, `screenshot?` | A new diagram: id, version 1, revision 1, links |
| `edit_cells` | `diagram_id`, `base_revision`, `operations`, `screenshot?` | The next version. Operations (`add`, `update`, `delete` by cell id) apply together or not at all; refused when the diagram changed after `base_revision` |
| `get_diagram` | `diagram_id`, `version?` | The XML of the first page, the revision and the version history, including the user's edits in the browser |
| `screenshot_diagram` | `diagram_id`, `version?` | A PNG to look at, with a checklist of problems to look for |
| `restore_version` | `diagram_id`, `version` | An earlier version saved as the next one |
| `generate_diagram` | `description` | A new diagram drawn by the server's model |
| `edit_diagram` | `change` + `diagram_id` (or `current_xml`) | The diagram's next version (a new diagram for `current_xml`) |
| `get_diagram_xml` | `diagram_id` | The whole `.drawio` file, every page |

`screenshot: true` adds the rendered PNG to the result, so the agent can check its drawing for overlaps and crossing connectors in the same call. Responses are otherwise a few lines: the id, the version, the revision and the links.

A diagram keeps its id while it changes; the last 20 versions are kept, and it expires 30 days after its last change. The tools edit and render the first page of a multi-page file and keep the other pages.

Pictures embedded in a diagram (a pasted screenshot or logo, kept in the cell style as base64) are shown by `get_diagram` as short references (`data:image/png,embedded-image-<id>`). Keep a reference as written in `edit_cells` and `create_diagram` and the picture is put back; `get_diagram_xml` returns the file with the pictures in it.

### The user edits the diagram too

The view link (`/d/<id>`) opens the diagram in its own editor page, apart from the app's canvas. The user's edits are saved there automatically, so the agent reads them with `get_diagram`.

Every accepted change raises the diagram's revision, and every result gives it. `edit_cells` takes the revision its change is based on and is refused when the diagram changed since: the agent then reads it again and redoes the change, so it never overwrites an edit it has not seen. `edit_diagram` is refused the same way when the diagram changed while the server's model drew. In the browser, a save based on an older revision is refused too, and the user chooses between loading the latest and keeping their version.

The history alternates between the two sides: the browser's saves update the current diagram without adding versions, and the user's edits become a version when an agent write replaces them. Saving from the browser needs the access code when the deployment sets one (`PUT /api/diagram/<id>`, `x-access-code`).

Generation by the server's model can take several minutes; the endpoint streams MCP progress notifications throughout, so clients and proxies keep the connection open.

### Getting a PNG

`GET /api/diagram/<id>/png` returns a PNG rendered on the server (send the `x-access-code` header). `?v=<version>` renders an earlier version and `?scale=1|2|3` sets the pixel density (default 2). The server renders with a headless Chromium (`CHROMIUM_PATH`; the Docker image includes one) and the draw.io bundled with the app, so no other host is contacted.

`/render/<id>` serves the diagram on its own, with no app UI, for a person to look at (`?v=<version>` for an earlier version).

Ask the agent something like *"draw an AWS three-tier architecture with an ALB, an EC2 auto-scaling group and RDS Multi-AZ"*. The response gives you a link to open/edit it in the app, and another to render it for a screenshot.

## Option 2: HTTP API

Agents that do not speak MCP can call the REST endpoint directly:

```bash
curl -X POST https://your-deployment.example.com/api/agent/diagram \
  -H "Content-Type: application/json" \
  -H "x-access-code: your-code" \
  -d '{"prompt":"AWS: users -> CloudFront -> ALB -> EC2 -> RDS"}'
```

A complex diagram can take a minute or more. When it takes longer than 20 seconds the response starts with status 200 and sends a space every 20 seconds until the JSON follows, so load balancers don't close it as idle (whitespace before JSON is valid, so ordinary JSON parsers read it). A failure after that point comes as `{ "error": ..., "status": <the status it would have had> }`.

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
  "version": 1,
  "cellCount": 12,
  "notes": [],
  "viewUrl": "https://your-deployment.example.com/d/<id>",
  "renderUrl": "https://your-deployment.example.com/render/<id>",
  "pngUrl": "https://your-deployment.example.com/api/diagram/<id>/png",
  "durableViewUrl": "https://your-deployment.example.com/#R..."
}
```

- `xml` — bare `<mxCell>` elements
- `mxfile` — a complete document that draw.io can open directly
- `id` — diagram id; use it with `/api/diagram/<id>` or the MCP tools
- `version` — version of the diagram this response stored
- `revision` — the diagram's revision after this change
- `cellCount` — number of cells, for a quick sanity check
- `notes` — XML auto-fixes that were applied, if any
- `viewUrl` — opens the diagram in its editor page; the user's edits are saved back
- `renderUrl` — render-only page
- `pngUrl` — PNG rendered on the server (needs the access code)
- `durableViewUrl` — self-contained link with the diagram in the URL fragment; longer, but keeps working after the diagram expires

Diagrams expire 30 days after their last change. Set `DIAGRAM_STORE_DIR` to keep them in files that survive restarts and deploys (a shared volume when several instances serve the app); without it they are kept in memory, at most 500. Ids are 128-bit random tokens, so the view links work without an access code.

Fetch a stored diagram directly with `GET /api/diagram/<id>` (add `?format=xml`
for the raw document).

### Links

Set `APP_BASE_URL` on the deployment to have responses include links. `viewUrl` opens the stored diagram's editor page (`/d/<id>`), `renderUrl` the diagram alone and `pngUrl` its PNG. `durableViewUrl` carries the diagram in the URL fragment instead: nothing on the server is needed, so it keeps working after the diagram expires, but edits made through it are not saved back.

## Tips

The more specific the description, the better the result. State which components exist and how they connect, for example:
`AWS: users -> CloudFront -> ALB -> EC2 in a private subnet -> RDS Multi-AZ`
