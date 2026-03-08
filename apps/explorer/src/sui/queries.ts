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

function extractFields(
  resp: SuiObjectResponse,
): Record<string, unknown> | null {
  const data = resp.data;
  if (!data?.content || data.content.dataType !== "moveObject") return null;
  return (data.content as { fields: Record<string, unknown> }).fields ?? null;
}

async function getObject(objectId: string): Promise<SuiObjectResponse> {
  return client.getObject({
    id: objectId,
    options: { showContent: true, showType: true, showOwner: true },
  });
}

async function multiGetObjects(ids: string[]): Promise<SuiObjectResponse[]> {
  if (ids.length === 0) return [];
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
 * Traverse all keys from a SUI Table via getDynamicFields.
 * Tables store entries as dynamic fields on the table's UID.
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
 * Get dynamic field objects from a Table (for Tables with non-bool values).
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

/** Extract the inner UID from a Table field */
function getTableId(
  fields: Record<string, unknown>,
  key: string,
): string | null {
  const table = fields[key];
  if (!table || typeof table !== "object") return null;
  const tableObj = table as {
    fields?: { id?: { id?: string }; size?: string };
  };
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
  const status = (
    ["online", "offline", "syncing"].includes(statusRaw)
      ? statusRaw
      : "offline"
  ) as PeerNode["status"];
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
 * Fetch AgentProfile DOFs from an Organization object.
 * Returns a map of agent address → { name, avatar_url }.
 */
async function fetchAgentProfiles(
  orgId: string,
): Promise<Map<string, { name: string; avatar_url: string }>> {
  const profileMap = new Map<string, { name: string; avatar_url: string }>();

  try {
    let cursor: string | null = null;
    let hasNext = true;

    while (hasNext) {
      const page = await client.getDynamicFields({
        parentId: orgId,
        cursor: cursor ?? undefined,
        limit: 50,
      });

      for (const entry of page.data) {
        // Filter only ProfileKey dynamic object fields
        if (
          entry.type === "DynamicObject" &&
          typeof entry.name.type === "string" &&
          entry.name.type.includes("::profile::ProfileKey")
        ) {
          const profileResp = await getObject(entry.objectId);
          const fields = extractFields(profileResp);
          if (!fields) continue;

          const agentAddr = getString(fields, "agent");
          const name = getString(fields, "name");
          const avatarUrl = getString(fields, "avatar_url");

          if (agentAddr) {
            profileMap.set(agentAddr, { name, avatar_url: avatarUrl });
          }
        }
      }

      cursor = page.nextCursor ?? null;
      hasNext = page.hasNextPage;
    }
  } catch (error) {
    console.error(`Failed to fetch AgentProfiles for org ${orgId}:`, error);
  }

  return profileMap;
}

async function fetchOrgIdsFromRegistry(): Promise<string[]> {
  const resp = await getObject(SUI_CONFIG.registry);
  const fields = extractFields(resp);
  if (!fields) return [];

  const orgsTableId = getTableId(fields, "organizations");
  if (!orgsTableId) return [];

  return getTableKeys(orgsTableId);
}

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

    const agentsTableId = getTableId(fields, "agents");
    if (agentsTableId && org.agent_count > 0) {
      org.agent_addresses = await getTableKeys(agentsTableId);
    }

    const tasksTableId = getTableId(fields, "tasks");
    if (tasksTableId && org.task_count > 0) {
      org.task_ids = await getTableKeys(tasksTableId);
    }

    const childOrgsTableId = getTableId(fields, "child_orgs");
    if (childOrgsTableId && org.child_org_count > 0) {
      org.child_org_ids = await getTableKeys(childOrgsTableId);
    }

    orgs.push(org);
  }

  return orgs;
}

async function fetchAgentCertificates(
  agentAddresses: string[],
  profilesByAgent: Map<string, { name: string; avatar_url: string }>,
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
        const cert = parseAgentCertificate(id, fields);
        const profile = profilesByAgent.get(cert.agent);
        if (profile) {
          cert.profile_name = profile.name;
          cert.profile_avatar_url = profile.avatar_url || undefined;
        }
        certs.push(cert);
      }

      cursor = page.nextCursor ?? null;
      hasNext = page.hasNextPage;
    }
  }

  return certs;
}

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

async function fetchPeerNodes(): Promise<PeerNode[]> {
  const resp = await getObject(SUI_CONFIG.peerRegistry);
  const fields = extractFields(resp);
  if (!fields) return [];

  const peersTableId = getTableId(fields, "peers");
  const peerCount = getTableSize(fields, "peers");
  if (!peersTableId || peerCount === 0) return [];

  const dfObjects = await getTableDynamicFieldObjects(peersTableId);
  const peers: PeerNode[] = [];

  for (const obj of dfObjects) {
    const objFields = extractFields(obj);
    if (!objFields) continue;
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

/** Fetch all data from the chain using Table-aware dynamic field traversal */
export async function fetchAllData() {
  const orgIds = await fetchOrgIdsFromRegistry();
  const organizations = await fetchOrganizationsWithTables(orgIds);

  const allAgentAddresses = new Set<string>();
  const allTaskIds = new Set<string>();
  const allProfiles = new Map<string, { name: string; avatar_url: string }>();

  for (const org of organizations) {
    for (const addr of org.agent_addresses) allAgentAddresses.add(addr);
    for (const tid of org.task_ids) allTaskIds.add(tid);
  }

  // Fetch profiles from all orgs in parallel
  const profileResults = await Promise.all(
    organizations.map((org) => fetchAgentProfiles(org.id)),
  );
  for (const profileMap of profileResults) {
    profileMap.forEach((profile, addr) => allProfiles.set(addr, profile));
  }

  const [agents, tasks, peers] = await Promise.all([
    fetchAgentCertificates([...allAgentAddresses], allProfiles),
    fetchTasks([...allTaskIds]),
    fetchPeerNodes(),
  ]);

  return { organizations, agents, tasks, peers };
}
