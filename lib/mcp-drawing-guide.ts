import { DRAWING_GUIDE } from "@/lib/drawing-guide"

/**
 * The drawing guide for agents that write the XML themselves over MCP: the
 * XML format, then the drawing guide the chat uses, with its tool names
 * replaced by the MCP tools that do the same.
 */

const XML_FORMAT = `
## XML format

Write draw.io mxCell elements. create_diagram takes bare mxCells (the wrapper and the root cells id="0" and id="1" are added), an <mxGraphModel> or a whole <mxfile>.

\`\`\`xml
<mxCell id="2" value="Web server" style="rounded=1;whiteSpace=wrap;html=1;" vertex="1" parent="1">
  <mxGeometry x="40" y="40" width="140" height="60" as="geometry"/>
</mxCell>
<mxCell id="3" value="Database" style="shape=cylinder3;whiteSpace=wrap;html=1;" vertex="1" parent="1">
  <mxGeometry x="280" y="30" width="100" height="80" as="geometry"/>
</mxCell>
<mxCell id="4" value="SQL" style="edgeStyle=orthogonalEdgeStyle;html=1;exitX=1;exitY=0.5;entryX=0;entryY=0.5;endArrow=classic;" edge="1" parent="1" source="2" target="3">
  <mxGeometry relative="1" as="geometry"/>
</mxCell>
\`\`\`

Rules:
1. All mxCells are siblings: never nest an mxCell in another. Containment is parent="<container id>", with the child's x and y relative to the container.
2. Ids are unique within the page. Use short, readable ids ("alb", "rds-primary"): edit_cells addresses cells by id.
3. Shapes have vertex="1" and an mxGeometry with x, y, width and height. Connectors have edge="1", source and target, and <mxGeometry relative="1" as="geometry"/>; waypoints go in <Array as="points"><mxPoint x="…" y="…"/></Array> inside it.
4. Escape &, <, > and " in attribute values (&amp; &lt; &gt; &quot;); a line break in a label is &#xa;. No XML comments.
5. edit_cells operations: update replaces a cell (give its whole new mxCell, same id), add appends one, delete removes a cell with its children and the connectors attached to it.
`

/** The guide get_drawing_guide returns; clearing a canvas has no MCP counterpart */
export const MCP_DRAWING_GUIDE = `${XML_FORMAT}${DRAWING_GUIDE}`
    .split("\n")
    .filter((line) => !line.includes("To clear the canvas"))
    .join("\n")
    .replaceAll("display_diagram", "create_diagram")
    .replaceAll("edit_diagram", "edit_cells")
    .replaceAll("the canvas", "the diagram")
