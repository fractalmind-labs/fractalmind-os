/** TypeScript types mirroring on-chain Move structs */

export interface Organization {
  id: string;
  name: string;
  description: string;
  admin: string;
  agents: string[];
  fractals: string[];
  tasks: string[];
  created_at: string;
}

export interface Agent {
  id: string;
  name: string;
  role: string;
  status: AgentStatus;
  org_id: string;
  capabilities: string[];
  tasks_assigned: string[];
  created_at: string;
}

export type AgentStatus = "active" | "idle" | "suspended" | "offline";

export interface Task {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  org_id: string;
  assignee: string | null;
  creator: string;
  created_at: string;
  updated_at: string;
}

export type TaskStatus =
  | "created"
  | "assigned"
  | "submitted"
  | "verified"
  | "completed";

export interface Fractal {
  id: string;
  name: string;
  parent_org: string;
  depth: number;
  agents: string[];
  sub_fractals: string[];
  created_at: string;
}

export interface PeerNode {
  id: string;
  node_id: string;
  endpoint: string;
  status: "online" | "offline" | "syncing";
  last_heartbeat: string;
  capabilities: string[];
}

/** Unified graph node for visualization */
export interface GraphNode {
  id: string;
  label: string;
  type: "org" | "fractal" | "agent" | "task" | "peer";
  status?: string;
  data: Organization | Agent | Task | Fractal | PeerNode;
  x?: number;
  y?: number;
  fx?: number | null;
  fy?: number | null;
}

export interface GraphLink {
  source: string;
  target: string;
  type: "contains" | "assigned" | "parent" | "peer-link";
}

export interface ExplorerData {
  organizations: Organization[];
  agents: Agent[];
  tasks: Task[];
  fractals: Fractal[];
  peers: PeerNode[];
  loading: boolean;
  error: string | null;
}
