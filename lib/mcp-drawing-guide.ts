import { DRAWING_GUIDE } from "@/lib/drawing-guide"

/**
 * The drawing guide adapted for the server's endpoints, where the tools and
 * the reader differ from the web chat's:
 *  - MCP_DRAWING_GUIDE: for agents that write the XML themselves over MCP
 *    (get_drawing_guide), with the chat's tool names replaced by the MCP tools.
 *  - AGENT_SYSTEM_PROMPT: for the server's own model when an agent asks it to
 *    draw (generate_diagram, edit_diagram, /api/agent/diagram), which has only
 *    display_diagram and get_shape_library and cannot see its result.
 */

const XML_RULES = `Rules:
1. All mxCells are siblings: never nest an mxCell in another. Containment is parent="<container id>", with the child's x and y relative to the container.
2. Ids are unique within the page. Use short, readable ids ("alb", "rds-primary"): later edits address cells by id.
3. Shapes have vertex="1" and an mxGeometry with x, y, width and height. Connectors have edge="1", source and target, and <mxGeometry relative="1" as="geometry"/>; waypoints go in <Array as="points"><mxPoint x="…" y="…"/></Array> inside it.
4. Escape &, <, > and " in attribute values (&amp; &lt; &gt; &quot;); a line break in a label is &#xa;. No XML comments.`

const XML_EXAMPLE = `\`\`\`xml
<mxCell id="web" value="Web server" style="rounded=1;whiteSpace=wrap;html=1;" vertex="1" parent="1">
  <mxGeometry x="40" y="40" width="140" height="60" as="geometry"/>
</mxCell>
<mxCell id="db" value="Database" style="shape=cylinder3;whiteSpace=wrap;html=1;" vertex="1" parent="1">
  <mxGeometry x="280" y="30" width="100" height="80" as="geometry"/>
</mxCell>
<mxCell id="web-db" value="SQL" style="edgeStyle=orthogonalEdgeStyle;html=1;exitX=1;exitY=0.5;entryX=0;entryY=0.5;endArrow=classic;" edge="1" parent="1" source="web" target="db">
  <mxGeometry relative="1" as="geometry"/>
</mxCell>
\`\`\``

/** The chat's drawing guide without the lines `drop` matches */
function guideWithout(drop: (line: string) => boolean): string {
    return DRAWING_GUIDE.split("\n")
        .filter((line) => !drop(line))
        .join("\n")
        .replaceAll("the canvas", "the diagram")
}

/** The guide get_drawing_guide returns; clearing a canvas has no MCP counterpart */
export const MCP_DRAWING_GUIDE = `
## XML format

Write draw.io mxCell elements. create_diagram takes bare mxCells (the wrapper and the root cells id="0" and id="1" are added), an <mxGraphModel> or a whole <mxfile>.

${XML_EXAMPLE}

${XML_RULES}
5. edit_cells operations: update replaces a cell (give its whole new mxCell, same id), add appends one, delete removes a cell with its children and the connectors attached to it.
${guideWithout((line) => line.includes("To clear the canvas"))}`
    .replaceAll("display_diagram", "create_diagram")
    .replaceAll("edit_diagram", "edit_cells")

/** The server model's instructions when an agent asks it for a diagram */
export const AGENT_SYSTEM_PROMPT = `
You draw draw.io diagrams for a program that calls an API, usually another AI agent. Only the diagram reaches the user; any text you write is at most one short sentence.

## Tools
- get_shape_library(library): exact style names of an icon library. Call it before using icons from any library (AWS, Azure, GCP, Kubernetes, Cisco...); never guess icon style names.
- display_diagram(xml): the diagram. Call it exactly once, with the complete diagram, after any get_shape_library calls. You cannot see the result, so lay it out carefully before you write it.

When the request includes the current diagram, return the whole page with the change made. Keep the id and style of every cell the change does not touch, so later edits by id still find them. Keep their positions too, except to make room: when you insert an element, move or widen its neighbours and containers so it gets its normal size (an AWS icon 78x78 or a tile 60x60) and its label stays clear; never shrink a new element to fit a gap. Every parent, source and target must name a cell on the page.

## XML format

Write only bare mxCell elements: the wrapper and the root cells id="0" and id="1" are added for you. Top-level cells have parent="1".

${XML_EXAMPLE}

${XML_RULES}
${guideWithout(
    (line) =>
        line.includes("To clear the canvas") ||
        // No screenshots and no edit tool here
        line.includes("screenshot") ||
        line.trim() === "Self-check:",
)}`
