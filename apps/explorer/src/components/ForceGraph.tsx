import { useRef, useEffect, useCallback } from "react";
import * as d3 from "d3";
import type {
  Organization,
  Agent,
  Task,
  Fractal,
  PeerNode,
  GraphNode,
  GraphLink,
} from "../sui/types.ts";
import { NODE_COLORS, truncateId } from "./utils.ts";

interface Props {
  organizations: Organization[];
  agents: Agent[];
  tasks: Task[];
  fractals: Fractal[];
  peers: PeerNode[];
  activeView: "org" | "tasks" | "peers";
  onNodeClick: (node: GraphNode) => void;
}

function buildGraph(
  orgs: Organization[],
  agents: Agent[],
  tasks: Task[],
  fractals: Fractal[],
  peers: PeerNode[],
  view: "org" | "tasks" | "peers",
): { nodes: GraphNode[]; links: GraphLink[] } {
  const nodes: GraphNode[] = [];
  const links: GraphLink[] = [];

  if (view === "org" || view === "tasks") {
    // Organization nodes
    for (const org of orgs) {
      nodes.push({ id: org.id, label: org.name || truncateId(org.id), type: "org", data: org });
    }

    // Fractal nodes
    for (const f of fractals) {
      nodes.push({ id: f.id, label: f.name || truncateId(f.id), type: "fractal", data: f });
      if (f.parent_org) {
        links.push({ source: f.parent_org, target: f.id, type: "contains" });
      }
    }

    // Agent nodes
    for (const a of agents) {
      nodes.push({
        id: a.id,
        label: a.name || truncateId(a.id),
        type: "agent",
        status: a.status,
        data: a,
      });
      // Link to org
      if (a.org_id) {
        links.push({ source: a.org_id, target: a.id, type: "contains" });
      }
    }

    if (view === "tasks") {
      // Task nodes
      for (const t of tasks) {
        nodes.push({
          id: t.id,
          label: t.title || truncateId(t.id),
          type: "task",
          status: t.status,
          data: t,
        });
        if (t.assignee) {
          links.push({ source: t.assignee, target: t.id, type: "assigned" });
        } else if (t.org_id) {
          links.push({ source: t.org_id, target: t.id, type: "contains" });
        }
      }
    }
  }

  if (view === "peers") {
    for (const p of peers) {
      nodes.push({
        id: p.id,
        label: p.node_id || truncateId(p.id),
        type: "peer",
        status: p.status,
        data: p,
      });
    }
    // Create a mesh topology between peers
    for (let i = 0; i < peers.length; i++) {
      for (let j = i + 1; j < peers.length; j++) {
        links.push({
          source: peers[i].id,
          target: peers[j].id,
          type: "peer-link",
        });
      }
    }
  }

  // Deduplicate: only keep links where both source and target exist in nodes
  const nodeIds = new Set(nodes.map((n) => n.id));
  const validLinks = links.filter(
    (l) => nodeIds.has(l.source as string) && nodeIds.has(l.target as string),
  );

  return { nodes, links: validLinks };
}

export default function ForceGraph({
  organizations,
  agents,
  tasks,
  fractals,
  peers,
  activeView,
  onNodeClick,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const render = useCallback(() => {
    const svg = svgRef.current;
    const container = containerRef.current;
    if (!svg || !container) return;

    const width = container.clientWidth;
    const height = container.clientHeight;

    const { nodes, links } = buildGraph(
      organizations,
      agents,
      tasks,
      fractals,
      peers,
      activeView,
    );

    // Clear previous
    const sel = d3.select(svg);
    sel.selectAll("*").remove();

    sel.attr("viewBox", `0 0 ${width} ${height}`);

    // Defs for glow effect
    const defs = sel.append("defs");
    const filter = defs.append("filter").attr("id", "glow");
    filter
      .append("feGaussianBlur")
      .attr("stdDeviation", "3")
      .attr("result", "coloredBlur");
    const feMerge = filter.append("feMerge");
    feMerge.append("feMergeNode").attr("in", "coloredBlur");
    feMerge.append("feMergeNode").attr("in", "SourceGraphic");

    const g = sel.append("g");

    // Zoom behavior
    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.2, 4])
      .on("zoom", (event) => {
        g.attr("transform", event.transform);
      });
    sel.call(zoom);

    // Simulation
    const simulation = d3
      .forceSimulation<GraphNode>(nodes)
      .force(
        "link",
        d3
          .forceLink<GraphNode, GraphLink>(links)
          .id((d) => d.id)
          .distance(100),
      )
      .force("charge", d3.forceManyBody().strength(-300))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collision", d3.forceCollide().radius(30));

    // Links
    const link = g
      .append("g")
      .selectAll("line")
      .data(links)
      .join("line")
      .attr("stroke", "#374151")
      .attr("stroke-width", 1.5)
      .attr("stroke-opacity", 0.6);

    // Node groups
    const node = g
      .append("g")
      .selectAll<SVGGElement, GraphNode>("g")
      .data(nodes)
      .join("g")
      .attr("cursor", "pointer")
      .on("click", (_event, d) => onNodeClick(d))
      .call(
        d3
          .drag<SVGGElement, GraphNode>()
          .on("start", (event, d) => {
            if (!event.active) simulation.alphaTarget(0.3).restart();
            d.fx = d.x;
            d.fy = d.y;
          })
          .on("drag", (event, d) => {
            d.fx = event.x;
            d.fy = event.y;
          })
          .on("end", (event, d) => {
            if (!event.active) simulation.alphaTarget(0);
            d.fx = null;
            d.fy = null;
          }),
      );

    // Node size by type
    const nodeRadius = (d: GraphNode) => {
      switch (d.type) {
        case "org":
          return 24;
        case "fractal":
          return 18;
        case "agent":
          return 16;
        case "task":
          return 12;
        case "peer":
          return 14;
        default:
          return 12;
      }
    };

    // Circle
    node
      .append("circle")
      .attr("r", nodeRadius)
      .attr("fill", (d) => NODE_COLORS[d.type] ?? "#6b7280")
      .attr("fill-opacity", 0.8)
      .attr("stroke", (d) => NODE_COLORS[d.type] ?? "#6b7280")
      .attr("stroke-width", 2)
      .attr("filter", "url(#glow)");

    // Icon text inside node
    const nodeIcon = (d: GraphNode) => {
      switch (d.type) {
        case "org":
          return "O";
        case "fractal":
          return "F";
        case "agent":
          return "A";
        case "task":
          return "T";
        case "peer":
          return "P";
        default:
          return "?";
      }
    };

    node
      .append("text")
      .attr("text-anchor", "middle")
      .attr("dominant-baseline", "central")
      .attr("fill", "white")
      .attr("font-size", (d) => (d.type === "org" ? "12px" : "10px"))
      .attr("font-weight", "bold")
      .attr("pointer-events", "none")
      .text(nodeIcon);

    // Label below node
    node
      .append("text")
      .attr("text-anchor", "middle")
      .attr("dy", (d) => nodeRadius(d) + 14)
      .attr("fill", "#9ca3af")
      .attr("font-size", "10px")
      .attr("pointer-events", "none")
      .text((d) =>
        d.label.length > 16 ? d.label.slice(0, 14) + "…" : d.label,
      );

    // Tick
    simulation.on("tick", () => {
      link
        .attr("x1", (d) => (d.source as unknown as GraphNode).x ?? 0)
        .attr("y1", (d) => (d.source as unknown as GraphNode).y ?? 0)
        .attr("x2", (d) => (d.target as unknown as GraphNode).x ?? 0)
        .attr("y2", (d) => (d.target as unknown as GraphNode).y ?? 0);

      node.attr("transform", (d) => `translate(${d.x ?? 0},${d.y ?? 0})`);
    });

    // Cleanup
    return () => {
      simulation.stop();
    };
  }, [organizations, agents, tasks, fractals, peers, activeView, onNodeClick]);

  useEffect(() => {
    const cleanup = render();
    const handleResize = () => render();
    window.addEventListener("resize", handleResize);
    return () => {
      cleanup?.();
      window.removeEventListener("resize", handleResize);
    };
  }, [render]);

  return (
    <div ref={containerRef} className="w-full h-full min-h-[400px]">
      <svg
        ref={svgRef}
        className="w-full h-full"
        style={{ background: "transparent" }}
      />
    </div>
  );
}
