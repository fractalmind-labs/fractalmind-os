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
import { NODE_COLORS, truncateId } from "./utils.ts";

interface Props {
  organizations: Organization[];
  agents: AgentCertificate[];
  tasks: Task[];
  peers: PeerNode[];
  activeView: "org" | "tasks" | "peers";
  onNodeClick: (node: GraphNode) => void;
}

function buildGraph(
  orgs: Organization[],
  agents: AgentCertificate[],
  tasks: Task[],
  peers: PeerNode[],
  view: "org" | "tasks" | "peers",
): { nodes: GraphNode[]; links: GraphLink[] } {
  const nodes: GraphNode[] = [];
  const links: GraphLink[] = [];

  if (view === "org" || view === "tasks") {
    // Organization nodes (root orgs vs sub-orgs distinguished by depth)
    for (const org of orgs) {
      const isSubOrg = org.depth > 0;
      nodes.push({
        id: org.id,
        label: org.name || truncateId(org.id),
        type: isSubOrg ? "suborg" : "org",
        data: org,
      });
      // Link sub-orgs to parent
      if (org.parent_org) {
        links.push({ source: org.parent_org, target: org.id, type: "parent" });
      }
    }

    // Agent nodes (from AgentCertificates)
    for (const a of agents) {
      nodes.push({
        id: a.id,
        label: truncateId(a.agent, 4),
        type: "agent",
        status: a.status,
        data: a,
      });
      // Link agent to its org
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
          // Try linking to agent cert; fall back to org
          const cert = agents.find(
            (a) => a.agent === t.assignee && a.org_id === t.org_id,
          );
          if (cert) {
            links.push({ source: cert.id, target: t.id, type: "assigned" });
          } else if (t.org_id) {
            links.push({ source: t.org_id, target: t.id, type: "contains" });
          }
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

  // Only keep links where both source and target exist in nodes
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
        case "suborg":
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
        case "suborg":
          return "S";
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
    <div ref={containerRef} className="w-full h-full min-h-[400px]">
      <svg
        ref={svgRef}
        className="w-full h-full"
        style={{ background: "transparent" }}
      />
    </div>
  );
}
