import type {
  Organization,
  AgentCertificate,
  Task,
  PeerNode,
  GraphNode,
  GraphLink,
} from "../sui/types.ts";
import { truncateId } from "./utils.ts";

export function buildGraph(
  orgs: Organization[],
  agents: AgentCertificate[],
  tasks: Task[],
  peers: PeerNode[],
  view: "org" | "tasks" | "peers",
): { nodes: GraphNode[]; links: GraphLink[] } {
  const nodes: GraphNode[] = [];
  const links: GraphLink[] = [];

  if (view === "org" || view === "tasks") {
    for (const org of orgs) {
      const isSubOrg = org.depth > 0;
      const displayName = org.name?.replace(/-\d{13}$/, "") || truncateId(org.id);
      const agentSuffix = org.agent_count > 0 ? ` (${org.agent_count}A)` : "";
      nodes.push({
        id: org.id,
        label: displayName + agentSuffix,
        type: isSubOrg ? "suborg" : "org",
        data: org,
      });
      if (org.parent_org) {
        links.push({ source: org.parent_org, target: org.id, type: "parent" });
      }
    }

    for (const a of agents) {
      nodes.push({
        id: a.id,
        label: a.profile_name || truncateId(a.agent, 4),
        type: "agent",
        status: a.status,
        data: a,
      });
      if (a.org_id) {
        links.push({ source: a.org_id, target: a.id, type: "contains" });
      }
    }

    if (view === "tasks") {
      for (const t of tasks) {
        nodes.push({
          id: t.id,
          label: t.title || truncateId(t.id),
          type: "task",
          status: t.status,
          data: t,
        });
        if (t.assignee) {
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

  const nodeIds = new Set(nodes.map((n) => n.id));
  const validLinks = links.filter(
    (l) => nodeIds.has(l.source as string) && nodeIds.has(l.target as string),
  );

  return { nodes, links: validLinks };
}
