import { useRef, useEffect, useCallback } from "react";
import * as d3 from "d3";
import type {
  Organization,
  AgentCertificate,
  Task,
  PeerNode,
  GraphNode,
  GraphLink,
} from "../sui/types.ts";
import { NODE_COLORS } from "./utils.ts";
import { buildGraph } from "./graphUtils.ts";

interface Props {
  organizations: Organization[];
  agents: AgentCertificate[];
  tasks: Task[];
  peers: PeerNode[];
  activeView: "org" | "tasks" | "peers";
  onNodeClick: (node: GraphNode) => void;
}

export default function ForceGraph({
  organizations,
  agents,
  tasks,
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
      peers,
      activeView,
    );

    const sel = d3.select(svg);
    sel.selectAll("*").remove();
    sel.attr("viewBox", `0 0 ${width} ${height}`);

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

    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.2, 4])
      .on("zoom", (event) => {
        g.attr("transform", event.transform);
      });
    sel.call(zoom);

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

    const link = g
      .append("g")
      .selectAll("line")
      .data(links)
      .join("line")
      .attr("stroke", "var(--color-graph-line)")
      .attr("stroke-width", 1.5)
      .attr("stroke-opacity", 0.6);

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

    const nodeRadius = (d: GraphNode) => {
      switch (d.type) {
        case "org": {
          const org = d.data as Organization;
          return Math.min(24 + (org.agent_count ?? 0) * 3, 40);
        }
        case "suborg": return 18;
        case "agent": return 16;
        case "task": return 12;
        case "peer": return 14;
        default: return 12;
      }
    };

    node
      .append("circle")
      .attr("r", nodeRadius)
      .attr("fill", (d) => NODE_COLORS[d.type] ?? "#6b7280")
      .attr("fill-opacity", 0.8)
      .attr("stroke", (d) => NODE_COLORS[d.type] ?? "#6b7280")
      .attr("stroke-width", 2)
      .attr("filter", "url(#glow)");

    const nodeIcon = (d: GraphNode) => {
      switch (d.type) {
        case "org": return "O";
        case "suborg": return "S";
        case "agent": return "A";
        case "task": return "T";
        case "peer": return "P";
        default: return "?";
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

    node
      .append("text")
      .attr("text-anchor", "middle")
      .attr("dy", (d) => nodeRadius(d) + 14)
      .attr("fill", "var(--color-graph-label)")
      .attr("font-size", "10px")
      .attr("pointer-events", "none")
      .text((d) => {
        const maxLen = d.type === "org" || d.type === "suborg" ? 24 : 16;
        return d.label.length > maxLen
          ? d.label.slice(0, maxLen - 2) + "…"
          : d.label;
      });

    simulation.on("tick", () => {
      link
        .attr("x1", (d) => (d.source as unknown as GraphNode).x ?? 0)
        .attr("y1", (d) => (d.source as unknown as GraphNode).y ?? 0)
        .attr("x2", (d) => (d.target as unknown as GraphNode).x ?? 0)
        .attr("y2", (d) => (d.target as unknown as GraphNode).y ?? 0);
      node.attr("transform", (d) => `translate(${d.x ?? 0},${d.y ?? 0})`);
    });

    return () => {
      simulation.stop();
    };
  }, [organizations, agents, tasks, peers, activeView, onNodeClick]);

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
    <div ref={containerRef} className="w-full h-full">
      <svg
        ref={svgRef}
        className="w-full h-full"
        style={{ background: "transparent" }}
      />
    </div>
  );
}
