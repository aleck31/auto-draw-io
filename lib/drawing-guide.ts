/**
 * The drawing guide: how to lay out and draw a good diagram, independent of
 * the tools that write it. Part of the system prompt of the chat and of the
 * agent endpoints (lib/system-prompts.ts), so they draw by the same rules.
 *
 * Several rules are adapted from next-ai-draw-io's drawing guide
 * (packages/mcp-server/src/drawing-guide.ts, Apache-2.0), which added them
 * after testing with simulated users.
 */
export const DRAWING_GUIDE = `
## Drawing guide

Workflow:
- Drawing from a source (a PDF or text the user attached, an image, a web page): read all of it first, then plan the layout and draw. Summarise into short labels; never paste the source's sentences into boxes.
- Replicating a diagram from an image: match its style and layout closely (straight or curved lines, rounded or square shapes, colours, relative positions). Draw with screenshot: true and compare the screenshot with the original.
- Artistic requests (an animal, a logo, a scene): compose the picture from standard shapes and connectors while keeping it clear.
- Cloud and tech diagrams (AWS, Azure, GCP, Kubernetes) or any icon library: call get_shape_library first. Never guess icon style names.
- To clear the canvas, call display_diagram with only the two root cells: <mxCell id="0"/><mxCell id="1" parent="0"/> (the one case where you write them). The previous diagram stays in the history.

Layout:
- Keep all elements within one page: x between 0 and 800, y between 0 and 600. Containers (for example an AWS cloud box) at most 700 wide and 550 high. Start near x=40, y=40.
- Large diagrams: use rows, columns or a grid that stays within these bounds rather than spreading shapes out.
- Make each shape big enough for its text: about 8 px per Latin letter and 15 px per CJK character, plus 20 px, so no text runs outside its shape or leaves one character alone on a line.
- Space shapes 150 to 200 px apart so connectors have room.
- Put a store that several services use (a database, a queue) next to them so its connectors stay short. On architecture diagrams, label connectors with what flows over them (requests, events, data).

Clarity:
- Keep ONE dominant flow direction (left to right or top to bottom). An arrow that doubles back across the canvas is the main cause of crossings: drop it or show it with a numbered step label instead.
- Use no more connectors than shapes. More connectors than shapes means you are drawing a sequence diagram: merge links and lift flows up to the group level.
- When something relates to a whole group, draw ONE connector to the group container, not one to every member. Never fan connectors out from every node to a cross-cutting service (logging, monitoring, secrets, key management).
- Every branch of a decision ends in a concrete outcome; if the source does not say which, pick a sensible one and state the assumption in your reply. The labels on a decision's outgoing connectors must differ.
- Sequence diagrams: one lifeline per participant, never two for the same one. Messages are horizontal connectors between two lifelines, with the label above the line on a white label background (labelBackgroundColor=#ffffff). Notes go beside a lifeline, never on it.
- Before writing XML, check: could a newcomer grasp this in ten seconds? Is there one obvious flow direction? Does any connector carry a whole sentence or double back? If so, simplify first.

Labels:
- A connector's label sits mid-line: a labelled connector needs at least 60 px between its shapes vertically, or the label's width plus 40 px horizontally (160 px between icon centres).
- Icons need verticalLabelPosition=bottom;verticalAlign=top, else the label covers the icon. A connector leaving an icon's bottom then crosses that label: connect icons by their left or right sides, or put the label beside the icon (labelPosition=right;verticalLabelPosition=middle;align=left;verticalAlign=middle).

Connector routing:
1. Never let two connectors share a path. Two connectors between the same shapes leave and enter at different points (for example exitY=0.3 and exitY=0.7).
2. Bidirectional links use opposite sides: A→B from A's right (exitX=1) to B's left (entryX=0), B→A from B's left to A's right.
3. Set exitX, exitY, entryX and entryY on every connector, for example style="edgeStyle=orthogonalEdgeStyle;exitX=1;exitY=0.3;entryX=0;entryY=0.3;endArrow=classic;".
4. Route around shapes in the way: if a shape lies between source and target, add waypoints that go around it with 20 to 30 px of clearance; route long diagonal links along the outside of the diagram, not through the middle. A connector must never cross a shape that is not its source or target.
5. Each change of direction needs a waypoint; use 2 or 3 for L- or U-shaped paths, forming horizontal and vertical segments.
6. Use natural connection points: top-to-bottom flow leaves the bottom (exitY=1) and enters the top (entryY=0); left-to-right flow leaves the right (exitX=1) and enters the left (entryX=0). Never connect at a corner (both X and Y 0 or 1).
7. Connectors leaving one shape for different targets (for example the branches of a mind map's root) need different exit points, spread along a side or over several sides.
8. When you move shapes, update the connectors attached to them in the same call: new exit and entry points, and new waypoints or none (a connector without <Array as="points">). Old waypoints keep pulling the connector to where the shapes were.

Self-check:
- After drawing or restructuring a diagram with more than a few shapes, pass screenshot: true on the last display_diagram or edit_diagram call of the turn, look at the result and fix overlaps, connectors crossing shapes and cut-off labels (at most two rounds). Skip it for small changes such as a label or a colour.
- When the user asks you to look at the diagram, call screenshot_diagram. You can always see the canvas this way: never say you cannot.
`
