import { SuiClient, SuiObjectResponse } from "@mysten/sui/client";
import { SUI_CONFIG } from "./config.ts";
import type {
  Organization,
  AgentCertificate,
  Task,
  PeerNode,
} from "./types.ts";
import { TASK_STATUS_MAP, AGENT_STATUS_MAP } from "./types.ts";

const client = new SuiClient({ url: SUI_CONFIG.rpcUrl });

// ── Low-level helpers ──────────────────────────────────────────────

/** Extract typed fields from a SUI object response */
function extractFields(
  resp: SuiObjectResponse,
): Record<string, unknown> | null {
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

/** Read multiple objects in a single batch (max 50 per call) */
async function multiGetObjects(ids: string[]): Promise<SuiObjectResponse[]> {
  if (ids.length === 0) return [];
  // SUI limits batch to 50 objects
  const results: SuiObjectResponse[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50);
    const resp = await client.multiGetObjects({
      ids: batch,
      options: { showContent: true, showType: true, showOwner: true },
    });
    results.push(...resp);
  }
  return results;
}

/**
 * Get all keys from a SUI Table by traversing its dynamic fields.
 * Tables store entries as dynamic fields on the table's UID.
 * Each dynamic field entry has `name.value` containing the key.
 */
async function getTableKeys(tableId: string): Promise<string[]> {
  const keys: string[] = [];
  let cursor: string | null = null;
  let hasNext = true;

  while (hasNext) {
    const page = await client.getDynamicFields({
      parentId: tableId,
      cursor: cursor ?? undefined,
      limit: 50,
    });
    for (const entry of page.data) {
      keys.push(String(entry.name.value));
    }
    cursor = page.nextCursor ?? null;
    hasNext = page.hasNextPage;
  }

  return keys;
}

/**
 * Get dynamic field objects from a Table (for Tables that store non-bool values).
 * Reads the actual dynamic field objects to extract stored values.
 */
async function getTableDynamicFieldObjects(
  tableId: string,
): Promise<SuiObjectResponse[]> {
  const objectIds: string[] = [];
  let cursor: string | null = null;
  let hasNext = true;

  while (hasNext) {
    const page = await client.getDynamicFields({
      parentId: tableId,
      cursor: cursor ?? undefined,
      limit: 50,
    });
    for (const entry of page.data) {
      objectIds.push(entry.objectId);
    }
    cursor = page.nextCursor ?? null;
    hasNext = page.hasNextPage;
  }

  return multiGetObjects(objectIds);
}

// ── Field helpers ──────────────────────────────────────────────────

function getString(fields: Record<string, unknown>, key: string): string {
  return String(fields[key] ?? "");
}

function getOptionalString(
  fields: Record<string, unknown>,
  key: string,
): string | null {
  const val = fields[key];
  if (val === null || val === undefined) return null;
  return String(val);
}

function getNumber(fields: Record<string, unknown>, key: string): number {
  return Number(fields[key] ?? 0);
}

function getStringArray(
  fields: Record<string, unknown>,
  key: string,
): string[] {
  const val = fields[key];
  if (Array.isArray(val)) return val.map(String);
  return [];
}

/** Extract the inner UID from a Table field: { type: "0x2::table::Table<...>", fields: { id: { id: "0x..." }, size: "N" } } */
function getTableId(fields: Record<string, unknown>, key: string): string | null {
  const table = fields[key];
  if (!table || typeof table !== "object") return null;
  const tableObj = table as { fields?: { id?: { id?: string }; size?: string } };
  return tableObj.fields?.id?.id ?? null;
}

function getTableSize(fields: Record<string, unknown>, key: string): number {
  const table = fields[key];
  if (!table || typeof table !== "object") return 0;
  const tableObj = table as { fields?: { size?: string } };
  return Number(tableObj.fields?.size ?? 0);
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
    depth: getNumber(fields, "depth"),
    is_active: fields["is_active"] === true,
    parent_org: getOptionalString(fields, "parent_org"),
    agent_count: getTableSize(fields, "agents"),
    task_count: getTableSize(fields, "tasks"),
    child_org_count: getTableSize(fields, "child_orgs"),
    // These will be populated via dynamic field traversal
    agent_addresses: [],
    task_ids: [],
    child_org_ids: [],
    created_at: getString(fields, "created_at"),
  };
}

function parseAgentCertificate(
  id: string,
  fields: Record<string, unknown>,
): AgentCertificate {
  const statusNum = getNumber(fields, "status");
  return {
    id,
    agent: getString(fields, "agent"),
    org_id: getString(fields, "org_id"),
    capability_tags: getStringArray(fields, "capability_tags"),
    reputation_score: getNumber(fields, "reputation_score"),
    status: AGENT_STATUS_MAP[statusNum] ?? "idle",
    tasks_completed: getNumber(fields, "tasks_completed"),
  };
}

function parseTask(id: string, fields: Record<string, unknown>): Task {
  const statusNum = getNumber(fields, "status");
  return {
    id,
    title: getString(fields, "title"),
    description: getString(fields, "description"),
    status: TASK_STATUS_MAP[statusNum] ?? "created",
    org_id: getString(fields, "org_id"),
    assignee: getOptionalString(fields, "assignee"),
    creator: getString(fields, "creator"),
    verifier: getOptionalString(fields, "verifier"),
    submission: getOptionalString(fields, "submission"),
    created_at: getString(fields, "created_at"),
    assigned_at: getOptionalString(fields, "assigned_at"),
    submitted_at: getOptionalString(fields, "submitted_at"),
    completed_at: getOptionalString(fields, "completed_at"),
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

/**
 * Step 1: Read Registry → traverse organizations Table → return org IDs.
 * Registry.organizations is Table<ID, bool>; keys are org object IDs.
 */
async function fetchOrgIdsFromRegistry(): Promise<string[]> {
  const resp = await getObject(SUI_CONFIG.registry);
  const fields = extractFields(resp);
  if (!fields) return [];

  const orgsTableId = getTableId(fields, "organizations");
  if (!orgsTableId) return [];

  return getTableKeys(orgsTableId);
}

/**
 * Step 2: Read Organization objects and resolve their Table fields.
 */
async function fetchOrganizationsWithTables(
  orgIds: string[],
): Promise<Organization[]> {
  const responses = await multiGetObjects(orgIds);
  const orgs: Organization[] = [];

  for (const r of responses) {
    const id = r.data?.objectId;
    const fields = extractFields(r);
    if (!id || !fields) continue;

    const org = parseOrganization(id, fields);

    // Resolve agents Table<address, bool> → agent addresses
    const agentsTableId = getTableId(fields, "agents");
    if (agentsTableId && org.agent_count > 0) {
      org.agent_addresses = await getTableKeys(agentsTableId);
    }

    // Resolve tasks Table<ID, bool> → task object IDs
    const tasksTableId = getTableId(fields, "tasks");
    if (tasksTableId && org.task_count > 0) {
      org.task_ids = await getTableKeys(tasksTableId);
    }

    // Resolve child_orgs Table<ID, bool> → child org IDs
    const childOrgsTableId = getTableId(fields, "child_orgs");
    if (childOrgsTableId && org.child_org_count > 0) {
      org.child_org_ids = await getTableKeys(childOrgsTableId);
    }

    orgs.push(org);
  }

  return orgs;
}

/**
 * Step 3: Find AgentCertificate objects for a set of agent addresses.
 * AgentCertificates are owned objects — query via getOwnedObjects per address.
 */
async function fetchAgentCertificates(
  agentAddresses: string[],
): Promise<AgentCertificate[]> {
  const certs: AgentCertificate[] = [];
  const seen = new Set<string>();

  for (const addr of agentAddresses) {
    let cursor: string | null = null;
    let hasNext = true;

    while (hasNext) {
      const page = await client.getOwnedObjects({
        owner: addr,
        filter: {
          StructType: `${SUI_CONFIG.protocolPackage}::agent::AgentCertificate`,
        },
        options: { showContent: true, showType: true },
        cursor: cursor ?? undefined,
        limit: 50,
      });

      for (const item of page.data) {
        const id = item.data?.objectId;
        if (!id || seen.has(id)) continue;
        seen.add(id);

        const fields = extractFields(item);
        if (!fields) continue;
        certs.push(parseAgentCertificate(id, fields));
      }

      cursor = page.nextCursor ?? null;
      hasNext = page.hasNextPage;
    }
  }

  return certs;
}

/**
 * Step 4: Read Task objects by ID.
 */
async function fetchTasks(taskIds: string[]): Promise<Task[]> {
  const responses = await multiGetObjects(taskIds);
  return responses
    .map((r) => {
      const id = r.data?.objectId;
      const fields = extractFields(r);
      if (!id || !fields) return null;
      return parseTask(id, fields);
    })
    .filter((t): t is Task => t !== null);
}

/**
 * Step 5: Read PeerRegistry → traverse peers Table<address, PeerNode>.
 * Unlike bool tables, this stores PeerNode structs as values.
 */
async function fetchPeerNodes(): Promise<PeerNode[]> {
  const resp = await getObject(SUI_CONFIG.peerRegistry);
  const fields = extractFields(resp);
  if (!fields) return [];

  const peersTableId = getTableId(fields, "peers");
  const peerCount = getTableSize(fields, "peers");
  if (!peersTableId || peerCount === 0) return [];

  // For Table<address, PeerNode>, the values are stored in dynamic field objects
  const dfObjects = await getTableDynamicFieldObjects(peersTableId);
  const peers: PeerNode[] = [];

  for (const obj of dfObjects) {
    const objFields = extractFields(obj);
    if (!objFields) continue;
    // Dynamic field object has { name: ..., value: { fields: { ... } } }
    const valueObj = objFields["value"];
    if (!valueObj || typeof valueObj !== "object") continue;
    const peerFields = (valueObj as { fields?: Record<string, unknown> })
      .fields;
    if (!peerFields) continue;
    const id = obj.data?.objectId ?? "";
    peers.push(parsePeerNode(id, peerFields));
  }

  return peers;
}

// ── Main entry point ───────────────────────────────────────────────

/** Fetch all data from the chain using Table-aware dynamic field traversal */
export async function fetchAllData() {
  // 1) Discover org IDs from Registry's organizations Table
  const orgIds = await fetchOrgIdsFromRegistry();

  // 2) Read all Organization objects and resolve their Table fields
  const organizations = await fetchOrganizationsWithTables(orgIds);

  // 3) Collect all unique agent addresses and task IDs across orgs
  const allAgentAddresses = new Set<string>();
  const allTaskIds = new Set<string>();

  for (const org of organizations) {
    for (const addr of org.agent_addresses) allAgentAddresses.add(addr);
    for (const tid of org.task_ids) allTaskIds.add(tid);
  }

  // 4) Fetch agent certificates and tasks in parallel
  const [agents, tasks, peers] = await Promise.all([
    fetchAgentCertificates([...allAgentAddresses]),
    fetchTasks([...allTaskIds]),
    fetchPeerNodes(),
  ]);

  return { organizations, agents, tasks, peers };
}
