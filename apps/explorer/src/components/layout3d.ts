import type { GraphNode, GraphLink } from "../sui/types.ts";

export interface LayoutNode {
  id: string;
  x: number;
  y: number;
  z: number;
}

/** Distribute `count` points evenly on a sphere shell of given `radius`. */
function spherePoints(
  cx: number,
  cy: number,
  cz: number,
  radius: number,
  count: number,
): { x: number; y: number; z: number }[] {
  if (count === 0) return [];
  if (count === 1) return [{ x: cx + radius, y: cy, z: cz }];

  const points: { x: number; y: number; z: number }[] = [];
  // Golden-angle spiral on sphere
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i++) {
    const y = 1 - (2 * i) / (count - 1 || 1); // -1..1
    const r = Math.sqrt(1 - y * y);
    const theta = goldenAngle * i;
    points.push({
      x: cx + r * Math.cos(theta) * radius,
      y: cy + y * radius,
      z: cz + r * Math.sin(theta) * radius,
    });
  }
  return points;
}

/**
 * Hierarchy-aware 3D layout.
 *
 * Phase 1: Seed positions based on hierarchy (org → agent → task).
 * Phase 2: Gentle force simulation to smooth overlaps while preserving structure.
 */
export function layout3d(
  nodes: GraphNode[],
  links: GraphLink[],
  iterations = 200,
): LayoutNode[] {
  if (nodes.length === 0) return [];

  // Build adjacency: source → target[] keyed by link type
  const childrenOf = new Map<string, string[]>(); // parent/contains
  const tasksOf = new Map<string, string[]>(); // assigned

  for (const link of links) {
    const src = link.source as string;
    const tgt = link.target as string;
    if (link.type === "parent" || link.type === "contains") {
      const arr = childrenOf.get(src) ?? [];
      arr.push(tgt);
      childrenOf.set(src, arr);
    } else if (link.type === "assigned") {
      const arr = tasksOf.get(src) ?? [];
      arr.push(tgt);
      tasksOf.set(src, arr);
    }
  }

  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const posMap = new Map<string, { x: number; y: number; z: number }>();

  // Categorize nodes
  const rootOrgs = nodes.filter((n) => n.type === "org");
  const subOrgs = nodes.filter((n) => n.type === "suborg");
  const agentNodes = nodes.filter((n) => n.type === "agent");
  const taskNodes = nodes.filter((n) => n.type === "task");
  const peerNodes = nodes.filter((n) => n.type === "peer");

  // --- Phase 1: Hierarchical seeding ---

  // Place root orgs on a wide circle in XZ plane
  const orgRadius = Math.max(rootOrgs.length * 3, 6);
  for (let i = 0; i < rootOrgs.length; i++) {
    const angle = (2 * Math.PI * i) / Math.max(rootOrgs.length, 1);
    posMap.set(rootOrgs[i].id, {
      x: Math.cos(angle) * orgRadius,
      y: 0,
      z: Math.sin(angle) * orgRadius,
    });
  }

  // Place sub-orgs near their parent org
  const subOrgsByParent = new Map<string, GraphNode[]>();
  for (const so of subOrgs) {
    // Find parent link
    const parentLink = links.find(
      (l) => l.type === "parent" && l.target === so.id,
    );
    const parentId = parentLink ? (parentLink.source as string) : undefined;
    if (parentId) {
      const arr = subOrgsByParent.get(parentId) ?? [];
      arr.push(so);
      subOrgsByParent.set(parentId, arr);
    }
  }

  for (const [parentId, children] of subOrgsByParent) {
    const parentPos = posMap.get(parentId) ?? { x: 0, y: 0, z: 0 };
    const pts = spherePoints(
      parentPos.x,
      parentPos.y,
      parentPos.z,
      4,
      children.length,
    );
    children.forEach((child, i) => posMap.set(child.id, pts[i]));
  }

  // Place agents around their org
  // Build org → agents map from links
  const agentsByOrg = new Map<string, GraphNode[]>();
  for (const agent of agentNodes) {
    const parentLink = links.find(
      (l) => l.type === "contains" && l.target === agent.id,
    );
    const orgId = parentLink ? (parentLink.source as string) : undefined;
    if (orgId) {
      const arr = agentsByOrg.get(orgId) ?? [];
      arr.push(agent);
      agentsByOrg.set(orgId, arr);
    }
  }

  for (const [orgId, orgAgents] of agentsByOrg) {
    const orgPos = posMap.get(orgId) ?? { x: 0, y: 0, z: 0 };
    const pts = spherePoints(
      orgPos.x,
      orgPos.y,
      orgPos.z,
      2.5,
      orgAgents.length,
    );
    orgAgents.forEach((agent, i) => posMap.set(agent.id, pts[i]));
  }

  // Place tasks around their agent or org
  for (const task of taskNodes) {
    const assignedLink = links.find(
      (l) => l.type === "assigned" && l.target === task.id,
    );
    const containsLink = links.find(
      (l) => l.type === "contains" && l.target === task.id,
    );
    const parentId = assignedLink
      ? (assignedLink.source as string)
      : containsLink
        ? (containsLink.source as string)
        : undefined;

    if (parentId && posMap.has(parentId)) {
      const pp = posMap.get(parentId)!;
      // Find how many tasks share this parent
      const siblings = taskNodes.filter((t) => {
        const al = links.find(
          (l) =>
            (l.type === "assigned" || l.type === "contains") &&
            l.target === t.id &&
            l.source === parentId,
        );
        return !!al;
      });
      const idx = siblings.indexOf(task);
      const pts = spherePoints(pp.x, pp.y, pp.z, 1.2, siblings.length);
      if (idx >= 0 && idx < pts.length) {
        posMap.set(task.id, pts[idx]);
      }
    }
  }

  // Place peers in a sphere (no hierarchy)
  if (peerNodes.length > 0) {
    const pts = spherePoints(0, 0, 0, 5, peerNodes.length);
    peerNodes.forEach((p, i) => posMap.set(p.id, pts[i]));
  }

  // Any remaining unplaced nodes get random positions
  for (const n of nodes) {
    if (!posMap.has(n.id)) {
      posMap.set(n.id, {
        x: (Math.random() - 0.5) * 10,
        y: (Math.random() - 0.5) * 10,
        z: (Math.random() - 0.5) * 10,
      });
    }
  }

  // --- Phase 2: Gentle force simulation to smooth overlaps ---
  const positions: LayoutNode[] = nodes.map((n) => {
    const p = posMap.get(n.id)!;
    return { id: n.id, x: p.x, y: p.y, z: p.z };
  });

  const idxMap = new Map<string, number>();
  positions.forEach((p, i) => idxMap.set(p.id, i));

  const repulsion = 20;
  const springK = 0.01;
  const damping = 0.85;
  const dt = 0.2;

  const vx = new Float64Array(positions.length);
  const vy = new Float64Array(positions.length);
  const vz = new Float64Array(positions.length);

  // Spring rest lengths per link type
  function springLen(type: GraphLink["type"]): number {
    switch (type) {
      case "parent":
        return 4;
      case "contains":
        return 2.5;
      case "assigned":
        return 1.2;
      case "peer-link":
        return 4;
    }
  }

  for (let iter = 0; iter < iterations; iter++) {
    const temp = 1 - iter / iterations;

    // Weak repulsion
    for (let i = 0; i < positions.length; i++) {
      for (let j = i + 1; j < positions.length; j++) {
        let dx = positions[i].x - positions[j].x;
        let dy = positions[i].y - positions[j].y;
        let dz = positions[i].z - positions[j].z;
        let dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (dist < 0.1) dist = 0.1;

        const force = (repulsion * temp) / (dist * dist);
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        const fz = (dz / dist) * force;

        vx[i] += fx;
        vy[i] += fy;
        vz[i] += fz;
        vx[j] -= fx;
        vy[j] -= fy;
        vz[j] -= fz;
      }
    }

    // Spring attraction along edges
    for (const link of links) {
      const si = idxMap.get(link.source as string);
      const ti = idxMap.get(link.target as string);
      if (si === undefined || ti === undefined) continue;

      let dx = positions[ti].x - positions[si].x;
      let dy = positions[ti].y - positions[si].y;
      let dz = positions[ti].z - positions[si].z;
      let dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist < 0.01) dist = 0.01;

      const rest = springLen(link.type);
      const displacement = dist - rest;
      const force = springK * displacement;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      const fz = (dz / dist) * force;

      vx[si] += fx;
      vy[si] += fy;
      vz[si] += fz;
      vx[ti] -= fx;
      vy[ti] -= fy;
      vz[ti] -= fz;
    }

    // Apply velocity + damping
    for (let i = 0; i < positions.length; i++) {
      vx[i] *= damping;
      vy[i] *= damping;
      vz[i] *= damping;
      positions[i].x += vx[i] * dt;
      positions[i].y += vy[i] * dt;
      positions[i].z += vz[i] * dt;
    }
  }

  return positions;
}
