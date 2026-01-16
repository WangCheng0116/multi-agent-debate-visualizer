import { Store } from "./state";
import { AgentNode, AppState, DebateMessage, MessageBubble } from "./types";

const SVG_NS = "http://www.w3.org/2000/svg";
const NODE_RADIUS = 18;
const DOT_OFFSET = 8;
const DOT_RADIUS = 4;
const ARROW_SIZE = 8;
const ARROW_ASPECT = 0.6;
const CONCLUSION_BOX_WIDTH = 150;
const CONCLUSION_BOX_HEIGHT = 44;
const CONCLUSION_BOX_PADDING = 6;
const CONCLUSION_BOX_OFFSET = 10;
const CONCLUSION_FONT_MAX = 11;
const CONCLUSION_FONT_MIN = 7;
const CONCLUSION_LINE_HEIGHT_RATIO = 1.2;
const lastConclusionById = new Map<string, string>();
const DOT_SIDES = ["right", "left", "top", "bottom"] as const;
type DotSide = (typeof DOT_SIDES)[number];

// Renders the list of agents in the sidebar
export function renderAgentList(
  container: HTMLUListElement,
  state: AppState,
  options: {
    selectedId?: string | null;
    onSelect?: (id: string) => void;
    onDelete?: (id: string) => void;
  } = {}
) {
  container.innerHTML = "";
  state.agents.forEach((agent) => {
    const li = document.createElement("li");
    li.className = "agent-list-item";
    if (options.selectedId === agent.id) {
      li.classList.add("is-selected");
    }
    li.setAttribute("data-agent-id", agent.id);
    if (options.onSelect) {
      li.addEventListener("click", () => options.onSelect?.(agent.id));
    }

    const nameSpan = document.createElement("span");
    nameSpan.className = "agent-name";
    nameSpan.textContent = agent.label;
    li.appendChild(nameSpan);

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "delete-agent-btn";
    deleteBtn.textContent = "×";
    deleteBtn.title = "Delete agent";
    if (options.onDelete) {
      deleteBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        options.onDelete?.(agent.id);
      });
    }
    li.appendChild(deleteBtn);

    container.appendChild(li);
  });
}

// Renders the entire graph visualisation (nodes and links)
export function renderGraph(svg: SVGSVGElement, state: AppState) {
  const { width, height } = svg.viewBox.baseVal;
  const nodes = state.agents;
  const positioned = placeNodes(nodes, width, height);
  const lookup = new Map(positioned.map((p) => [p.node.id, p]));
  const currentNodeIds = new Set(nodes.map((node) => node.id));
  const arrowheadTargets = new Map<string, Set<DotSide>>();

  // Determine data source based on playback mode
  let conclusions: Map<string, string>;
  let bubbles: typeof state.bubbles;

  if (state.playback) {
    // Replay mode - use computed playback state
    conclusions = state.playback.conclusions;
    bubbles = state.playback.activeBubbles;
  } else {
    // Live mode - use current state
    conclusions = new Map(
      state.agents
        .filter(a => a.conclusion)
        .map(a => [a.id, a.conclusion!])
    );
    bubbles = state.bubbles;
  }

  svg.innerHTML = "";

  // Calculate incoming edge counts and indices for each node
  const incomingEdges = new Map<string, { edges: typeof state.edges; index: Map<string, number> }>();
  state.edges.forEach((edge) => {
    if (!incomingEdges.has(edge.to)) {
      incomingEdges.set(edge.to, { edges: [], index: new Map() });
    }
    const entry = incomingEdges.get(edge.to)!;
    entry.index.set(edge.from, entry.edges.length);
    entry.edges.push(edge);
  });

  // Draw links first so they appear behind nodes
  state.edges.forEach((edge) => {
    const fromNode = lookup.get(edge.from);
    const toNode = lookup.get(edge.to);
    if (!fromNode || !toNode) return;

    const incomingInfo = incomingEdges.get(edge.to);
    const incomingCount = incomingInfo?.edges.length ?? 1;
    const incomingIndex = incomingInfo?.index.get(edge.from) ?? 0;

    const path = createLinkPath(fromNode, toNode, incomingCount, incomingIndex);
    path.setAttribute("data-edge-id", edge.id);
    svg.appendChild(path);

    const { fromSide, toSide } = getAnchors(fromNode, toNode);
    if (edge.direction === "a_to_b") {
      addArrowheadTarget(arrowheadTargets, edge.to, toSide);
    } else if (edge.direction === "b_to_a") {
      addArrowheadTarget(arrowheadTargets, edge.from, fromSide);
    } else {
      addArrowheadTarget(arrowheadTargets, edge.to, toSide);
      addArrowheadTarget(arrowheadTargets, edge.from, fromSide);
    }
  });

  // Draw nodes
  positioned.forEach(({ node, x, y }) => {
    const group = document.createElementNS(SVG_NS, "g");
    const groupClasses = ["node-group"];
    if (node.id === state.selectedAgentId) {
      groupClasses.push("is-selected");
    }
    group.setAttribute("class", groupClasses.join(" "));
    group.setAttribute("data-node-id", node.id);
    group.setAttribute("transform", `translate(${x - NODE_RADIUS}, ${y - NODE_RADIUS})`);

    const circle = document.createElementNS(SVG_NS, "circle");
    circle.setAttribute("class", "node-circle");
    circle.setAttribute("cx", String(NODE_RADIUS));
    circle.setAttribute("cy", String(NODE_RADIUS));
    circle.setAttribute("r", String(NODE_RADIUS));

    const text = document.createElementNS(SVG_NS, "text");
    text.setAttribute("class", "node-label");
    text.setAttribute("x", String(NODE_RADIUS));
    text.setAttribute("y", String(NODE_RADIUS));
    text.textContent = node.label;

    const conclusionText = normalizeConclusionText(conclusions.get(node.id) || "");
    if (conclusionText) {
      const previous = lastConclusionById.get(node.id);
      const shouldFlash = previous !== undefined && previous !== conclusionText;
      const conclusionGroup = document.createElementNS(SVG_NS, "g");
      const className = shouldFlash ? "conclusion-box is-flash" : "conclusion-box";
      conclusionGroup.setAttribute("class", className);
      conclusionGroup.setAttribute(
        "transform",
        `translate(${NODE_RADIUS - CONCLUSION_BOX_WIDTH / 2}, ${-CONCLUSION_BOX_HEIGHT - CONCLUSION_BOX_OFFSET})`
      );

      const rect = document.createElementNS(SVG_NS, "rect");
      rect.setAttribute("class", "conclusion-box-rect");
      rect.setAttribute("width", String(CONCLUSION_BOX_WIDTH));
      rect.setAttribute("height", String(CONCLUSION_BOX_HEIGHT));
      rect.setAttribute("rx", "6");
      rect.setAttribute("ry", "6");
      conclusionGroup.appendChild(rect);

      const maxWidth = CONCLUSION_BOX_WIDTH - CONCLUSION_BOX_PADDING * 2;
      const maxHeight = CONCLUSION_BOX_HEIGHT - CONCLUSION_BOX_PADDING * 2;
      let fontSize = CONCLUSION_FONT_MAX;
      let lineHeight = Math.round(fontSize * CONCLUSION_LINE_HEIGHT_RATIO);
      let lines = wrapTextLines(conclusionText, maxWidth, fontSize);

      while (lines.length * lineHeight > maxHeight && fontSize > CONCLUSION_FONT_MIN) {
        fontSize -= 1;
        lineHeight = Math.round(fontSize * CONCLUSION_LINE_HEIGHT_RATIO);
        lines = wrapTextLines(conclusionText, maxWidth, fontSize);
      }

      const contentHeight = lines.length * lineHeight;
      const startY = CONCLUSION_BOX_PADDING + Math.max(0, (maxHeight - contentHeight) / 2);

      lines.forEach((line, index) => {
        const lineText = document.createElementNS(SVG_NS, "text");
        lineText.setAttribute("class", "conclusion-box-text");
        lineText.setAttribute("x", String(CONCLUSION_BOX_WIDTH / 2));
        lineText.setAttribute("y", String(startY + index * lineHeight));
        lineText.setAttribute("font-size", String(fontSize));
        lineText.textContent = line;
        conclusionGroup.appendChild(lineText);
      });

      group.appendChild(conclusionGroup);
    }

    if (conclusionText) {
      lastConclusionById.set(node.id, conclusionText);
    } else {
      lastConclusionById.delete(node.id);
    }

    DOT_SIDES.forEach((side) => {
      if (arrowheadTargets.get(node.id)?.has(side)) {
        return;
      }
      const dot = document.createElementNS(SVG_NS, "circle");
      dot.setAttribute("class", `connection-dot connection-dot-${side}`);
      dot.setAttribute("r", String(DOT_RADIUS));
      dot.setAttribute("data-dot-from", node.id);
      dot.setAttribute("data-dot-side", side);

      const { x: dotX, y: dotY } = getDotPosition({ x: NODE_RADIUS, y: NODE_RADIUS }, side);
      dot.setAttribute("cx", String(dotX));
      dot.setAttribute("cy", String(dotY));
      group.appendChild(dot);
    });

    group.appendChild(circle);
    group.appendChild(text);
    svg.appendChild(group);
  });

  // Draw arrowheads above nodes
  renderArrowheads(svg, state.edges, lookup, incomingEdges);

  // Draw message bubbles (apply expansion state from persistent map)
  renderBubbles(svg, bubbles, lookup, state.bubbleExpansionState);

  Array.from(lastConclusionById.keys()).forEach((id) => {
    if (!currentNodeIds.has(id)) {
      lastConclusionById.delete(id);
    }
  });
}

// Renders message bubbles on the graph
function renderBubbles(
  svg: SVGSVGElement,
  bubbles: MessageBubble[],
  nodePositions: Map<string, { x: number; y: number }>,
  expansionState: Map<string, boolean>
) {
  bubbles.forEach((bubble) => {
    const from = nodePositions.get(bubble.fromNode);
    const to = nodePositions.get(bubble.toNode);
    if (!from || !to) return;

    // Apply expansion state from persistent map (overrides bubble.expanded)
    const isExpanded = expansionState.get(bubble.id) ?? bubble.expanded;

    // Calculate position along the path based on progress
    const x = from.x + (to.x - from.x) * bubble.progress;
    const y = from.y + (to.y - from.y) * bubble.progress;

    const group = document.createElementNS(SVG_NS, "g");
    const groupClasses = ["message-bubble"];
    if (isExpanded) {
      groupClasses.push("is-expanded");
    }
    group.setAttribute("class", groupClasses.join(" "));
    group.setAttribute("data-bubble-id", bubble.id);

    // Word wrapping configuration
    const padding = 10;
    const lineHeight = 14;
    const fontSize = 11;
    const arrowSize = 6;
    const arrowPadding = 4;

    let bubbleWidth: number;
    let bubbleHeight: number;
    let contentElements: SVGElement[] = [];

    if (isExpanded) {
      // Expanded state: show full text + separator + comment
      const maxWidth = 280;
      const minWidth = 200;
      const maxTextWidth = maxWidth - padding * 2;
      const maxFullTextHeight = 150;
      const separatorMargin = 8;
      const commentLabelHeight = lineHeight;

      // Wrap full text
      const fullTextLines = wrapTextLines(bubble.fullText, maxTextWidth, fontSize);
      const fullTextHeight = Math.min(
        fullTextLines.length * lineHeight,
        maxFullTextHeight
      );

      // Wrap comment label
      const commentLabel = `Comment: ${bubble.summary}`;
      const commentLines = wrapTextLines(commentLabel, maxTextWidth, fontSize - 1);
      const commentHeight = commentLines.length * lineHeight;

      // Calculate dimensions
      const maxLineWidth = Math.max(
        ...fullTextLines.map((line) => estimateTextWidth(line, fontSize)),
        ...commentLines.map((line) => estimateTextWidth(line, fontSize - 1))
      );
      bubbleWidth = Math.min(maxWidth, Math.max(minWidth, maxLineWidth + padding * 2));
      bubbleHeight = padding + fullTextHeight + separatorMargin * 2 + commentHeight + padding + arrowSize + arrowPadding;

      let currentY = padding;

      // Render full text lines (scrollable region conceptually, but we truncate)
      const maxFullTextLines = Math.floor(maxFullTextHeight / lineHeight);
      const displayFullTextLines = fullTextLines.slice(0, maxFullTextLines);
      displayFullTextLines.forEach((line, i) => {
        const text = document.createElementNS(SVG_NS, "text");
        text.setAttribute("class", "bubble-full-text");
        text.setAttribute("x", String(bubbleWidth / 2));
        text.setAttribute("y", String(currentY + lineHeight * (i + 0.8)));
        text.textContent = line;
        contentElements.push(text);
      });
      currentY += fullTextHeight + separatorMargin;

      // Separator line
      const separator = document.createElementNS(SVG_NS, "line");
      separator.setAttribute("x1", String(padding));
      separator.setAttribute("y1", String(currentY));
      separator.setAttribute("x2", String(bubbleWidth - padding));
      separator.setAttribute("y2", String(currentY));
      separator.setAttribute("class", "bubble-separator");
      contentElements.push(separator);
      currentY += separatorMargin;

      // Comment label
      commentLines.forEach((line, i) => {
        const text = document.createElementNS(SVG_NS, "text");
        text.setAttribute("class", "bubble-comment-label");
        text.setAttribute("x", String(bubbleWidth / 2));
        text.setAttribute("y", String(currentY + lineHeight * (i + 0.8)));
        text.textContent = line;
        contentElements.push(text);
      });
    } else {
      // Collapsed state: show summary only
      const maxWidth = 180;
      const maxLines = 4;
      const maxTextWidth = maxWidth - padding * 2;
      const lines = wrapTextLines(bubble.summary, maxTextWidth, fontSize);

      // Limit to max lines and add ellipsis if needed
      const displayLines = lines.slice(0, maxLines);
      if (lines.length > maxLines) {
        displayLines[maxLines - 1] = truncateToWidth(
          displayLines[maxLines - 1],
          maxTextWidth,
          fontSize
        );
      }

      // Calculate bubble dimensions
      const maxLineWidth = displayLines.length
        ? Math.max(...displayLines.map((line) => estimateTextWidth(line, fontSize)))
        : 0;
      bubbleWidth = Math.min(maxWidth, Math.max(60, maxLineWidth) + padding * 2);
      bubbleHeight = displayLines.length * lineHeight + padding * 2 + arrowSize + arrowPadding;

      // Render text lines
      displayLines.forEach((line, i) => {
        const text = document.createElementNS(SVG_NS, "text");
        text.setAttribute("x", String(bubbleWidth / 2));
        text.setAttribute("y", String(padding + lineHeight * (i + 0.8)));
        text.textContent = line;
        contentElements.push(text);
      });
    }

    // Position bubble centered on the calculated point
    group.setAttribute(
      "transform",
      `translate(${x - bubbleWidth / 2}, ${y - bubbleHeight / 2})`
    );

    // Background rounded rectangle
    const rect = document.createElementNS(SVG_NS, "rect");
    rect.setAttribute("width", String(bubbleWidth));
    rect.setAttribute("height", String(bubbleHeight));
    rect.setAttribute("rx", "8");
    rect.setAttribute("ry", "8");
    group.appendChild(rect);

    // Append content elements
    contentElements.forEach((el) => group.appendChild(el));

    // Add down/up arrow (only if fullText is not empty)
    if (bubble.fullText && bubble.fullText.trim()) {
      const arrow = document.createElementNS(SVG_NS, "polygon");
      const arrowY = bubbleHeight - arrowSize - arrowPadding / 2;
      const arrowX = bubbleWidth - arrowSize - arrowPadding;
      const points = `${arrowX},${arrowY} ${arrowX + arrowSize},${arrowY} ${arrowX + arrowSize / 2},${arrowY + arrowSize}`;
      arrow.setAttribute("points", points);
      arrow.setAttribute("class", "bubble-arrow");
      group.appendChild(arrow);
    }

    svg.appendChild(group);
  });
}

// Renders messages in the message log panel
export function renderMessages(container: HTMLElement, messages: DebateMessage[], agents: AgentNode[]) {
  container.innerHTML = "";

  if (!messages.length) {
    container.innerHTML = `<p class="subtitle">No messages yet. Click "Run Debate" to start.</p>`;
    return;
  }

  // Create a map of agent IDs to labels
  const agentLabels = new Map(agents.map((a) => [a.id, a.label]));
  agentLabels.set("aggregator", "Aggregator");

  messages.forEach((message) => {
    const fromLabel = agentLabels.get(message.from) || message.from;
    const toLabel = agentLabels.get(message.to) || message.to;

    const item = document.createElement("div");
    item.className = "message-item";
    item.setAttribute("data-from", message.from);

    // In round 1, show "user → AgentLabel" instead of "FromLabel → ToLabel"
    const routeDisplay = message.round === 1 ? `user → ${toLabel}` : `${fromLabel} → ${toLabel}`;

    const meta = document.createElement("div");
    meta.className = "message-meta";
    meta.innerHTML = `
      <span class="message-round">Round ${message.round}</span>
      <span class="message-route">${routeDisplay}</span>
    `;

    item.appendChild(meta);

    const trimmedText = message.text.trim();
    if (trimmedText) {
      const text = document.createElement("p");
      text.className = "message-text";
      text.textContent = message.text;
      item.appendChild(text);
    }

    if (message.summary) {
      // Add separator line between text and summary
      if (trimmedText) {
        const separator = document.createElement("hr");
        separator.className = "message-separator";
        item.appendChild(separator);
      }

      const summary = document.createElement("p");
      summary.className = "message-summary";
      if (message.from === "aggregator") {
        summary.classList.add("is-aggregator");
      }
      summary.textContent = message.summary;
      item.appendChild(summary);
    }

    container.appendChild(item);
  });

  // Scroll to bottom
  container.scrollTop = container.scrollHeight;
}

// Binds all interaction handlers
export function bindInteractions(
  svg: SVGSVGElement,
  store: Store,
  onWarn?: (message: string) => void
) {
  let interactionState:
    | { type: "dragging"; id: string }
    | { type: "connecting"; fromId: string; side: DotSide }
    | null = null;

  let tempLink: SVGPathElement | null = null;
  let raf = 0;

  svg.addEventListener("pointerdown", (e) => {
    const target = e.target as SVGElement;
    const connectDot = target.closest(".connection-dot");
    const nodeGroup = target.closest(".node-group");

    if (connectDot) {
      const fromId = connectDot.getAttribute("data-dot-from");
      if (!fromId) return;
      const side = (connectDot.getAttribute("data-dot-side") as DotSide) || "right";

      e.stopPropagation();
      interactionState = { type: "connecting", fromId, side };

      tempLink = document.createElementNS(SVG_NS, "path");
      tempLink.setAttribute("class", "temp-link");
      svg.appendChild(tempLink);

      const fromNodeGroup = svg.querySelector(`.node-group[data-node-id="${fromId}"]`);
      if (!fromNodeGroup) return;
      const transform = (fromNodeGroup as SVGGElement).transform.baseVal[0];
      if (!transform) return;

      const fromNodePos = { x: transform.matrix.e + NODE_RADIUS, y: transform.matrix.f + NODE_RADIUS };
      const dotPos = getDotPosition(fromNodePos, side);
      const endPoint = toSvgPoint(svg, e.clientX, e.clientY);

      tempLink.setAttribute("d", `M ${dotPos.x} ${dotPos.y} L ${endPoint.x} ${endPoint.y}`);
    } else if (nodeGroup) {
      const id = nodeGroup.getAttribute("data-node-id");
      if (!id) return;
      store.setSelectedAgent(id);
      interactionState = { type: "dragging", id };
      nodeGroup.classList.add("dragging");
    }
  });

  svg.addEventListener("pointermove", (e) => {
    if (!interactionState) return;
    if (raf) cancelAnimationFrame(raf);

    raf = requestAnimationFrame(() => {
      const { x, y } = toSvgPoint(svg, e.clientX, e.clientY);

      if (interactionState?.type === "dragging") {
        store.setPosition(interactionState.id, x, y);
      } else if (interactionState?.type === "connecting" && tempLink) {
        const fromId = interactionState.fromId;
        const fromNodeGroup = svg.querySelector(`.node-group[data-node-id="${fromId}"]`);
        if (!fromNodeGroup) return;
        const transform = (fromNodeGroup as SVGGElement).transform.baseVal[0];
        if (!transform) return;

        const fromNodePos = { x: transform.matrix.e + NODE_RADIUS, y: transform.matrix.f + NODE_RADIUS };
        const dotPos = getDotPosition(fromNodePos, interactionState.side);
        tempLink.setAttribute("d", `M ${dotPos.x} ${dotPos.y} L ${x} ${y}`);
      }
    });
  });

  svg.addEventListener("pointerup", (e) => {
    if (interactionState?.type === "connecting") {
      const target = e.target as SVGElement;
      const toNode = target.closest(".node-group");
      if (toNode) {
        const toId = toNode.getAttribute("data-node-id");
        if (toId) {
          if (interactionState.fromId !== toId) {
            const created = store.upsertEdge(interactionState.fromId, toId, "a_to_b");
            if (!created) {
              onWarn?.("This connection already exists.");
            }
          }
        }
      }
    }

    // Reset state
    document.querySelector(".node-group.dragging")?.classList.remove("dragging");
    interactionState = null;
    tempLink?.remove();
    tempLink = null;
  });

  // Edge click handler for deleting
  svg.addEventListener("click", (e) => {
    const target = e.target as SVGElement;

    // Handle bubble expansion toggle
    const bubbleGroup = target.closest(".message-bubble");
    if (bubbleGroup) {
      const bubbleId = bubbleGroup.getAttribute("data-bubble-id");
      if (bubbleId) {
        store.toggleBubbleExpansion(bubbleId);
        e.stopPropagation();
        return;
      }
    }

    // Handle edge deletion
    if (target.classList.contains("link-path")) {
      const edgeId = target.getAttribute("data-edge-id");
      if (edgeId) {
        store.deleteEdge(edgeId);
      }
    }
  });
}

// Builds the SVG <defs> element for arrow markers
// Calculates the path for a link between two nodes
function createLinkPath(
  from: { x: number; y: number },
  to: { x: number; y: number },
  incomingCount: number = 1,
  incomingIndex: number = 0
) {
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("class", "link-path");

  const { start, end } = getLinkPoints(from, to, incomingCount, incomingIndex);
  path.setAttribute("d", `M ${start.x} ${start.y} L ${end.x} ${end.y}`);
  return path;
}

// Automatically places nodes in a circle if they don't have a position
function placeNodes(nodes: AgentNode[], width: number, height: number) {
  const sideMargin = NODE_RADIUS + 16;
  const topMargin = NODE_RADIUS + CONCLUSION_BOX_HEIGHT + CONCLUSION_BOX_OFFSET + 8;
  const bottomMargin = NODE_RADIUS + 16;
  const availableWidth = Math.max(0, width - sideMargin * 2);
  const availableHeight = Math.max(0, height - topMargin - bottomMargin);
  const radius = Math.min(availableWidth, availableHeight) / 3;
  const cx = sideMargin + availableWidth / 2;
  const cy = topMargin + availableHeight / 2;
  const angleStep = nodes.length > 1 ? (Math.PI * 2) / nodes.length : 0;

  return nodes.map((node, idx) => {
    if (node.position) {
      return { node, x: node.position.x, y: node.position.y };
    }
    const angle = idx * angleStep - Math.PI / 2; // Start from top
    return {
      node,
      x: cx + radius * Math.cos(angle),
      y: cy + radius * Math.sin(angle)
    };
  });
}

function toSvgPoint(svg: SVGSVGElement, clientX: number, clientY: number) {
  const pt = svg.createSVGPoint();
  pt.x = clientX;
  pt.y = clientY;
  const ctm = svg.getScreenCTM();
  return ctm ? pt.matrixTransform(ctm.inverse()) : pt;
}

function renderArrowheads(
  svg: SVGSVGElement,
  edges: AppState["edges"],
  lookup: Map<string, { x: number; y: number }>,
  incomingEdges: Map<string, { edges: AppState["edges"]; index: Map<string, number> }>
) {
  edges.forEach((edge) => {
    const fromNode = lookup.get(edge.from);
    const toNode = lookup.get(edge.to);
    if (!fromNode || !toNode) return;

    const incomingInfo = incomingEdges.get(edge.to);
    const incomingCount = incomingInfo?.edges.length ?? 1;
    const incomingIndex = incomingInfo?.index.get(edge.from) ?? 0;
    const { start, end } = getLinkPoints(fromNode, toNode, incomingCount, incomingIndex);
    const angle = Math.atan2(end.y - start.y, end.x - start.x);

    if (edge.direction === "a_to_b") {
      svg.appendChild(createArrowhead(end, angle));
    } else if (edge.direction === "b_to_a") {
      svg.appendChild(createArrowhead(start, angle + Math.PI));
    } else {
      svg.appendChild(createArrowhead(end, angle));
      svg.appendChild(createArrowhead(start, angle + Math.PI));
    }
  });
}

function createArrowhead(center: { x: number; y: number }, angle: number) {
  const path = document.createElementNS(SVG_NS, "path");
  const half = ARROW_SIZE / 2;
  const halfHeight = (ARROW_SIZE * ARROW_ASPECT) / 2;
  const angleDeg = (angle * 180) / Math.PI;

  path.setAttribute(
    "d",
    `M ${half},0 L ${-half},${-halfHeight} L ${-half},${halfHeight} Z`
  );
  path.setAttribute("class", "edge-arrowhead");
  path.setAttribute("transform", `translate(${center.x}, ${center.y}) rotate(${angleDeg})`);
  return path;
}

function getDotPosition(position: { x: number; y: number }, side: DotSide) {
  switch (side) {
    case "left":
      return { x: position.x - NODE_RADIUS - DOT_OFFSET, y: position.y };
    case "right":
      return { x: position.x + NODE_RADIUS + DOT_OFFSET, y: position.y };
    case "top":
      return { x: position.x, y: position.y - NODE_RADIUS - DOT_OFFSET };
    case "bottom":
      return { x: position.x, y: position.y + NODE_RADIUS + DOT_OFFSET };
    default:
      return { x: position.x + NODE_RADIUS + DOT_OFFSET, y: position.y };
  }
}

function wrapTextLines(text: string, maxWidth: number, fontSize: number) {
  if (!text) return [];

  const useWords = /\s/.test(text);
  const tokens = useWords ? text.split(/\s+/).filter(Boolean) : Array.from(text);
  const lines: string[] = [];
  let current = "";

  const pushCurrent = () => {
    if (current) lines.push(current);
    current = "";
  };

  for (const token of tokens) {
    if (useWords && estimateTextWidth(token, fontSize) > maxWidth) {
      const chars = Array.from(token);
      for (const ch of chars) {
        const next = current ? current + ch : ch;
        if (estimateTextWidth(next, fontSize) > maxWidth && current) {
          pushCurrent();
          current = ch;
        } else {
          current = next;
        }
      }
      continue;
    }

    const next = current
      ? useWords
        ? `${current} ${token}`
        : current + token
      : token;

    if (estimateTextWidth(next, fontSize) > maxWidth && current) {
      pushCurrent();
      current = token;
    } else {
      current = next;
    }
  }

  if (current) lines.push(current);
  return lines;
}

function normalizeConclusionText(text: string) {
  return text.trim().replace(/\s+/g, " ");
}

function truncateToWidth(text: string, maxWidth: number, fontSize: number) {
  const ellipsis = "...";
  let trimmed = text.trim();

  while (trimmed.length && estimateTextWidth(trimmed + ellipsis, fontSize) > maxWidth) {
    trimmed = trimmed.slice(0, -1);
  }

  return trimmed ? trimmed + ellipsis : ellipsis;
}

function estimateTextWidth(text: string, fontSize: number) {
  let width = 0;
  for (const ch of text) {
    if (ch === " ") {
      width += fontSize * 0.35;
    } else if (ch.charCodeAt(0) <= 0x7f) {
      width += fontSize * 0.6;
    } else {
      width += fontSize * 1.0;
    }
  }
  return width;
}

function getAnchors(from: { x: number; y: number }, to: { x: number; y: number }) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const isHorizontal = Math.abs(dx) >= Math.abs(dy);

  if (isHorizontal) {
    const fromSide: DotSide = dx >= 0 ? "right" : "left";
    const toSide: DotSide = dx >= 0 ? "left" : "right";
    return {
      start: getDotPosition(from, fromSide),
      end: getDotPosition(to, toSide),
      isHorizontal,
      fromSide,
      toSide
    };
  }

  const fromSide: DotSide = dy >= 0 ? "bottom" : "top";
  const toSide: DotSide = dy >= 0 ? "top" : "bottom";
  return {
    start: getDotPosition(from, fromSide),
    end: getDotPosition(to, toSide),
    isHorizontal,
    fromSide,
    toSide
  };
}

function getLinkPoints(
  from: { x: number; y: number },
  to: { x: number; y: number },
  incomingCount: number = 1,
  incomingIndex: number = 0
) {
  const { start, end, isHorizontal } = getAnchors(from, to);
  const maxOffset = NODE_RADIUS * 0.8;
  let endOffset = 0;
  if (incomingCount > 1) {
    const step = maxOffset / (incomingCount - 1);
    endOffset = -maxOffset / 2 + step * incomingIndex;
  }
  const endX = isHorizontal ? end.x : end.x + endOffset;
  const endY = isHorizontal ? end.y + endOffset : end.y;

  return { start, end: { x: endX, y: endY } };
}

function addArrowheadTarget(
  targets: Map<string, Set<DotSide>>,
  nodeId: string,
  side: DotSide
) {
  if (!targets.has(nodeId)) {
    targets.set(nodeId, new Set<DotSide>());
  }
  targets.get(nodeId)!.add(side);
}
