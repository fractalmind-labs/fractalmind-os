/**
 * TypeScript types mirroring actual on-chain Move structs.
 *
 * Key differences from naive assumptions:
 * - Registry and Organization use 0x2::table::Table (not vectors)
 * - Child orgs are Organization objects with depth > 0 (no separate Fractal type)
 * - Agents are tracked by address; details come from AgentCertificate owned objects
 * - Task status is a u8 (0-4), mapped to string here
 * - PeerRegistry.peers is also a Table
 */

export interface Organization {
  id: string;
  name: string;
  description: string;
  admin: string;
  depth: number;
  is_active: boolean;
  parent_org: string | null;
  agent_count: number;
  task_count: number;
  child_org_count: number;
  /** Resolved from agents Table<address, bool> via dynamic fields */
  agent_addresses: string[];
  /** Resolved from tasks Table<ID, bool> via dynamic fields */
  task_ids: string[];
  /** Resolved from child_orgs Table<ID, bool> via dynamic fields */
  child_org_ids: string[];
  created_at: string;
}

export interface AgentCertificate {
  id: string;
  agent: string;
  org_id: string;
  capability_tags: string[];
  reputation_score: number;
  status: AgentStatus;
  tasks_completed: number;
}

/** Agent status u8: 0 = active, 1 = idle, 2 = suspended, 3 = offline */
export type AgentStatus = "active" | "idle" | "suspended" | "offline";

export const AGENT_STATUS_MAP: Record<number, AgentStatus> = {
  0: "active",
  1: "idle",
  2: "suspended",
  3: "offline",
};

export interface Task {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  org_id: string;
  assignee: string | null;
  creator: string;
  verifier: string | null;
  submission: string | null;
  created_at: string;
  assigned_at: string | null;
  submitted_at: string | null;
  completed_at: string | null;
}

/** Task status u8: 0=created, 1=assigned, 2=submitted, 3=verified, 4=completed */
export type TaskStatus =
  | "created"
  | "assigned"
  | "submitted"
  | "verified"
  | "completed";

export const TASK_STATUS_MAP: Record<number, TaskStatus> = {
  0: "created",
  1: "assigned",
  2: "submitted",
  3: "verified",
  4: "completed",
};

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
  type: "org" | "suborg" | "agent" | "task" | "peer";
  status?: string;
  data: Organization | AgentCertificate | Task | PeerNode;
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
  agents: AgentCertificate[];
  tasks: Task[];
  peers: PeerNode[];
  loading: boolean;
  error: string | null;
}
