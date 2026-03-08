import type { GraphNode, GraphLink } from "../sui/types.ts";

export interface LayoutNode {
  id: string;
  x: number;
  y: number;
  z: number;
}

/**
 * Simple 3D force-directed layout using Coulomb repulsion + spring attraction.
 * O(n²) per iteration — fine for <50 nodes.
 */
export function layout3d(
  nodes: GraphNode[],
  links: GraphLink[],
  iterations = 300,
): LayoutNode[] {
  const positions: LayoutNode[] = nodes.map((n) => ({
    id: n.id,
    x: (Math.random() - 0.5) * 10,
    y: (Math.random() - 0.5) * 10,
    z: (Math.random() - 0.5) * 10,
  }));

  const idxMap = new Map<string, number>();
  positions.forEach((p, i) => idxMap.set(p.id, i));

  const repulsion = 50;
  const springK = 0.02;
  const springLen = 3;
  const damping = 0.9;
  const dt = 0.3;

  const vx = new Float64Array(positions.length);
  const vy = new Float64Array(positions.length);
  const vz = new Float64Array(positions.length);

  for (let iter = 0; iter < iterations; iter++) {
    const temp = 1 - iter / iterations;

    // Coulomb repulsion between all pairs
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

      const displacement = dist - springLen;
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
