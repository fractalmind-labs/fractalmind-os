import { SuiClient, SuiObjectResponse } from "@mysten/sui/client";
import { SUI_CONFIG } from "./config.ts";
import type {
  Organization,
  Agent,
  Task,
  Fractal,
  PeerNode,
} from "./types.ts";

const client = new SuiClient({ url: SUI_CONFIG.rpcUrl });

/** Extract typed fields from a SUI object response */
function extractFields(resp: SuiObjectResponse): Record<string, unknown> | null {
  const data = resp.data;
  if (!data?.content || data.content.dataType !== "moveObject") return null;
  return (data.content as { fields: Record<string, unknown> }).fields ?? null;
}

/** Read a single object by ID with full content */
async function getObject(objectId: string): Promise<SuiObjectResponse> {
  return client.getObject({
    id: objectId,
    options: { showContent: true, showType: true, showOwner: true },
  });
}

/** Read multiple objects in a single batch */
async function multiGetObjects(ids: string[]): Promise<SuiObjectResponse[]> {
  if (ids.length === 0) return [];
  return client.multiGetObjects({
    ids,
    options: { showContent: true, showType: true, showOwner: true },
  });
}

// ── Field helpers ──────────────────────────────────────────────────

function getString(fields: Record<string, unknown>, key: string): string {
  return String(fields[key] ?? "");
}

function getStringArray(
  fields: Record<string, unknown>,
  key: string,
): string[] {
  const val = fields[key];
  if (Array.isArray(val)) return val.map(String);
  // SUI stores Vec as { type: "...", fields: { contents: [...] } }
  if (val && typeof val === "object" && "fields" in val) {
    const inner = (val as { fields: { contents?: unknown[] } }).fields;
    if (Array.isArray(inner?.contents)) return inner.contents.map(String);
  }
  return [];
}

// ── Parse functions ────────────────────────────────────────────────

function parseOrganization(
  id: string,
  fields: Record<string, unknown>,
): Organization {
  return {
    id,
    name: getString(fields, "name"),
    description: getString(fields, "description"),
    admin: getString(fields, "admin"),
    agents: getStringArray(fields, "agents"),
    fractals: getStringArray(fields, "fractals"),
    tasks: getStringArray(fields, "tasks"),
    created_at: getString(fields, "created_at"),
  };
}

function parseAgent(id: string, fields: Record<string, unknown>): Agent {
  const statusRaw = getString(fields, "status").toLowerCase();
  const status = (["active", "idle", "suspended", "offline"].includes(statusRaw)
    ? statusRaw
    : "idle") as Agent["status"];
  return {
    id,
    name: getString(fields, "name"),
    role: getString(fields, "role"),
    status,
    org_id: getString(fields, "org_id"),
    capabilities: getStringArray(fields, "capabilities"),
    tasks_assigned: getStringArray(fields, "tasks_assigned"),
    created_at: getString(fields, "created_at"),
  };
}

function parseTask(id: string, fields: Record<string, unknown>): Task {
  const statusRaw = getString(fields, "status").toLowerCase();
  const validStatuses = ["created", "assigned", "submitted", "verified", "completed"];
  const status = (validStatuses.includes(statusRaw)
    ? statusRaw
    : "created") as Task["status"];
  return {
    id,
    title: getString(fields, "title"),
    description: getString(fields, "description"),
    status,
    org_id: getString(fields, "org_id"),
    assignee: fields["assignee"] ? getString(fields, "assignee") : null,
    creator: getString(fields, "creator"),
    created_at: getString(fields, "created_at"),
    updated_at: getString(fields, "updated_at"),
  };
}

function parseFractal(id: string, fields: Record<string, unknown>): Fractal {
  return {
    id,
    name: getString(fields, "name"),
    parent_org: getString(fields, "parent_org"),
    depth: Number(fields["depth"] ?? 0),
    agents: getStringArray(fields, "agents"),
    sub_fractals: getStringArray(fields, "sub_fractals"),
    created_at: getString(fields, "created_at"),
  };
}

function parsePeerNode(
  id: string,
  fields: Record<string, unknown>,
): PeerNode {
  const statusRaw = getString(fields, "status").toLowerCase();
  const status = (["online", "offline", "syncing"].includes(statusRaw)
    ? statusRaw
    : "offline") as PeerNode["status"];
  return {
    id,
    node_id: getString(fields, "node_id"),
    endpoint: getString(fields, "endpoint"),
    status,
    last_heartbeat: getString(fields, "last_heartbeat"),
    capabilities: getStringArray(fields, "capabilities"),
  };
}

// ── Public query API ───────────────────────────────────────────────

/** Fetch the Registry and discover all referenced objects */
export async function fetchRegistry(): Promise<{
  orgIds: string[];
  agentIds: string[];
  taskIds: string[];
  fractalIds: string[];
}> {
  const resp = await getObject(SUI_CONFIG.registry);
  const fields = extractFields(resp);
  if (!fields) {
    return { orgIds: [], agentIds: [], taskIds: [], fractalIds: [] };
  }

  return {
    orgIds: getStringArray(fields, "organizations"),
    agentIds: getStringArray(fields, "agents"),
    taskIds: getStringArray(fields, "tasks"),
    fractalIds: getStringArray(fields, "fractals"),
  };
}

/** Fetch Organizations by their IDs */
export async function fetchOrganizations(
  ids: string[],
): Promise<Organization[]> {
  const responses = await multiGetObjects(ids);
  return responses
    .map((r) => {
      const id = r.data?.objectId;
      const fields = extractFields(r);
      if (!id || !fields) return null;
      return parseOrganization(id, fields);
    })
    .filter((o): o is Organization => o !== null);
}

/** Fetch Agents by their IDs */
export async function fetchAgents(ids: string[]): Promise<Agent[]> {
  const responses = await multiGetObjects(ids);
  return responses
    .map((r) => {
      const id = r.data?.objectId;
      const fields = extractFields(r);
      if (!id || !fields) return null;
      return parseAgent(id, fields);
    })
    .filter((a): a is Agent => a !== null);
}

/** Fetch Tasks by their IDs */
export async function fetchTasks(ids: string[]): Promise<Task[]> {
  const responses = await multiGetObjects(ids);
  return responses
    .map((r) => {
      const id = r.data?.objectId;
      const fields = extractFields(r);
      if (!id || !fields) return null;
      return parseTask(id, fields);
    })
    .filter((t): t is Task => t !== null);
}

/** Fetch Fractals by their IDs */
export async function fetchFractals(ids: string[]): Promise<Fractal[]> {
  const responses = await multiGetObjects(ids);
  return responses
    .map((r) => {
      const id = r.data?.objectId;
      const fields = extractFields(r);
      if (!id || !fields) return null;
      return parseFractal(id, fields);
    })
    .filter((f): f is Fractal => f !== null);
}

/** Fetch the PeerRegistry and discover peer nodes */
export async function fetchPeerRegistry(): Promise<PeerNode[]> {
  const resp = await getObject(SUI_CONFIG.peerRegistry);
  const fields = extractFields(resp);
  if (!fields) return [];

  const peerIds = getStringArray(fields, "peers");
  if (peerIds.length === 0) return [];

  const responses = await multiGetObjects(peerIds);
  return responses
    .map((r) => {
      const id = r.data?.objectId;
      const f = extractFields(r);
      if (!id || !f) return null;
      return parsePeerNode(id, f);
    })
    .filter((p): p is PeerNode => p !== null);
}

/** Fetch all data from the chain in one call */
export async function fetchAllData() {
  // 1) Read registry to discover object IDs
  const registry = await fetchRegistry();

  // 2) Fetch all objects in parallel
  const [organizations, agents, tasks, fractals, peers] = await Promise.all([
    fetchOrganizations(registry.orgIds),
    fetchAgents(registry.agentIds),
    fetchTasks(registry.taskIds),
    fetchFractals(registry.fractalIds),
    fetchPeerRegistry(),
  ]);

  return { organizations, agents, tasks, fractals, peers };
}
