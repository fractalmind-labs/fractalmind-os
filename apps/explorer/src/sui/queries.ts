import { fromBase64 } from "@mysten/bcs";
import { SUI_CONFIG } from "./config.ts";
import {
  Address,
  AgentCertificate as AgentCertificateBcs,
  AgentProfile as AgentProfileBcs,
  Organization as OrganizationBcs,
  PeerNode as PeerNodeBcs,
  PeerRegistry as PeerRegistryBcs,
  ProtocolRegistry,
  Task as TaskBcs,
} from "./bcs.ts";
import {
  getAllDynamicFields,
  getObjectContents,
  getOwnedObjectsByType,
  multiGetObjectContents,
  type MoveContents,
} from "./graphql.ts";
import type {
  Organization,
  AgentCertificate,
  Task,
  PeerNode,
} from "./types.ts";
import { TASK_STATUS_MAP, AGENT_STATUS_MAP } from "./types.ts";

const GRAPHQL_URL = SUI_CONFIG.graphqlUrl;

function decode(bcs: MoveContents["bcs"]): Uint8Array {
  return fromBase64(bcs);
}

// ── Table traversal ────────────────────────────────────────────────

/**
 * Keys of a `Table<address | ID, _>` (every table this app reads uses one
 * of those two 32-byte key types). Dynamic field names come back with the
 * key's raw BCS bytes directly, so no extra object fetch is needed just to
 * list keys.
 */
async function getTableKeys(tableId: string): Promise<string[]> {
  const nodes = await getAllDynamicFields(GRAPHQL_URL, tableId);
  return nodes.map((node) => Address.parse(decode(node.name.bcs)));
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
    const nodes = await getAllDynamicFields(GRAPHQL_URL, orgId);
    for (const node of nodes) {
      if (!node.name.type.repr.includes("::profile::ProfileKey")) continue;
      if (node.value.__typename !== "MoveObject") continue;

      const profile = AgentProfileBcs.parse(decode(node.value.contents.bcs));
      if (profile.agent) {
        profileMap.set(profile.agent, {
          name: profile.name,
          avatar_url: profile.avatar_url,
        });
      }
    }
  } catch (error) {
    console.error(`Failed to fetch AgentProfiles for org ${orgId}:`, error);
  }

  return profileMap;
}

async function fetchOrgIdsFromRegistry(): Promise<string[]> {
  const contents = await getObjectContents(GRAPHQL_URL, SUI_CONFIG.registry);
  if (!contents) return [];

  const registry = ProtocolRegistry.parse(decode(contents.bcs));
  return getTableKeys(registry.organizations.id);
}

async function fetchOrganizationsWithTables(
  orgIds: string[],
): Promise<Organization[]> {
  const contentsList = await multiGetObjectContents(GRAPHQL_URL, orgIds);
  const orgs: Organization[] = [];

  for (const contents of contentsList) {
    if (!contents) continue;
    const raw = OrganizationBcs.parse(decode(contents.bcs));

    const org: Organization = {
      id: raw.id,
      name: raw.name,
      description: raw.description,
      admin: raw.admin,
      depth: Number(raw.depth),
      is_active: raw.is_active,
      parent_org: raw.parent_org,
      agent_count: Number(raw.agent_count),
      task_count: Number(raw.task_count),
      child_org_count: Number(raw.child_org_count),
      agent_addresses: [],
      task_ids: [],
      child_org_ids: [],
      created_at: raw.created_at,
    };

    if (org.agent_count > 0) {
      org.agent_addresses = await getTableKeys(raw.agents.id);
    }
    if (org.task_count > 0) {
      org.task_ids = await getTableKeys(raw.tasks.id);
    }
    if (org.child_org_count > 0) {
      org.child_org_ids = await getTableKeys(raw.child_orgs.id);
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
  const structType = `${SUI_CONFIG.protocolPackage}::agent::AgentCertificate`;

  for (const addr of agentAddresses) {
    const owned = await getOwnedObjectsByType(GRAPHQL_URL, addr, structType);

    for (const { contents } of owned) {
      const raw = AgentCertificateBcs.parse(decode(contents.bcs));
      const cert: AgentCertificate = {
        id: raw.id,
        agent: raw.agent,
        org_id: raw.org_id,
        capability_tags: raw.capability_tags,
        reputation_score: Number(raw.reputation_score),
        status: AGENT_STATUS_MAP[raw.status] ?? "idle",
        tasks_completed: Number(raw.tasks_completed),
      };
      const profile = profilesByAgent.get(cert.agent);
      if (profile) {
        cert.profile_name = profile.name;
        cert.profile_avatar_url = profile.avatar_url || undefined;
      }
      certs.push(cert);
    }
  }

  return certs;
}

async function fetchTasks(taskIds: string[]): Promise<Task[]> {
  const contentsList = await multiGetObjectContents(GRAPHQL_URL, taskIds);

  return contentsList
    .map((contents) => {
      if (!contents) return null;
      const raw = TaskBcs.parse(decode(contents.bcs));
      const task: Task = {
        id: raw.id,
        title: raw.title,
        description: raw.description,
        status: TASK_STATUS_MAP[raw.status] ?? "created",
        org_id: raw.org_id,
        assignee: raw.assignee,
        creator: raw.creator,
        verifier: raw.verifier,
        submission: raw.submission,
        created_at: raw.created_at,
        assigned_at: raw.assigned_at,
        submitted_at: raw.submitted_at,
        completed_at: raw.completed_at,
      };
      return task;
    })
    .filter((t): t is Task => t !== null);
}

/**
 * `PeerRegistry.peers` is a `Table<address, PeerNode>`. `PeerNode` has
 * `store, drop` (not `key`), so its Table entries are plain dynamic field
 * *values*, not separate objects — no per-entry object fetch is needed.
 *
 * No peer has ever registered on testnet (`peer_count` is 0), so unlike the
 * other decoders in this file, this one hasn't been checked against a real
 * on-chain `PeerNode`. `PeerNode`'s own fields also don't line up one-to-one
 * with this app's `PeerNode` UI type (there is no on-chain `node_id` or
 * `last_heartbeat`, and no "syncing" status); the mapping below is the
 * closest reasonable match, not a verified one.
 */
async function fetchPeerNodes(): Promise<PeerNode[]> {
  const contents = await getObjectContents(
    GRAPHQL_URL,
    SUI_CONFIG.peerRegistry,
  );
  if (!contents) return [];

  const registry = PeerRegistryBcs.parse(decode(contents.bcs));
  if (Number(registry.peer_count) === 0) return [];

  const nodes = await getAllDynamicFields(GRAPHQL_URL, registry.peers.id);
  const peers: PeerNode[] = [];

  for (const node of nodes) {
    if (node.value.__typename !== "MoveValue") continue;
    try {
      const raw = PeerNodeBcs.parse(decode(node.value.bcs));
      peers.push({
        id: Address.parse(decode(node.name.bcs)),
        node_id: raw.hostname,
        endpoint: raw.endpoints[0] ?? "",
        status: raw.status === 0 ? "online" : "offline",
        last_heartbeat: raw.last_updated,
        capabilities: raw.endpoints,
      });
    } catch (error) {
      console.error("Failed to decode PeerNode:", error);
    }
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
