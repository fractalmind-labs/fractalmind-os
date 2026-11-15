// Chain reader for the human side of Agent CLI pairing.  There is intentionally
// no local request directory: pairing requests and the Agent marker are public
// on-chain facts, and every displayed row is re-validated from those facts.
import { bcs } from "@mysten/sui/bcs";
import { Ed25519PublicKey } from "@mysten/sui/keypairs/ed25519";
import {
  AgentOperatorBcs,
  DevicePairingRequestBcs,
  pairingCode,
  pairingFingerprint,
} from "@fractalmind-labs/fractalmind-sdk";
import { ChainReadSession, missingDynamicField } from "./chain";
import { isExpiredOrRevoked, parseAgentActivity, type AgentActivity } from "./agent-operators";

const MAX_EVENT_PAGES = 20;
const MAX_PAIRINGS = 1_000;
const id = /^0x[0-9a-f]{64}$/;
const PairingCreatedBcs = bcs.struct("DevicePairingCreated", {
  request_id: bcs.Address,
  human_id: bcs.Address,
  device: bcs.Address,
});
const fieldless = new Uint8Array([0]);

export class AgentOperatorChainError extends Error {
  constructor(readonly code: "invalid_source" | "unsupported_network" | "directory_too_large") {
    super(code);
  }
}

export type AgentPairing = {
  request: ReturnType<typeof DevicePairingRequestBcs.parse>;
  code: string;
};
export type AgentOperatorRow = {
  grant: {
    id: string;
    human_id: string;
    device: string;
    org_scope: string | null;
    actions: number[];
    expires_at_ms: bigint | string | number;
    revoked: boolean;
    generation: bigint | string | number;
  };
  label: string;
  approvedBy: string;
  balance: string;
  activity: AgentActivity[];
  inactive: boolean;
};
export type AgentOperatorDirectory = {
  nowMs: bigint;
  pending: AgentPairing[];
  active: AgentOperatorRow[];
  inactive: AgentOperatorRow[];
};

function invalid(): never {
  throw new AgentOperatorChainError("invalid_source");
}
function assertLocalnet(chain: ChainReadSession) {
  if (chain.profile.network !== "localnet") throw new AgentOperatorChainError("unsupported_network");
}

async function marker(
  chain: ChainReadSession,
  parentId: string,
  keyName: "AgentPairingKey" | "AgentOperatorKey",
  valueName?: "AgentOperator",
) {
  const keyType = await chain.sdk.client.coreType("identity", keyName);
  try {
    const { dynamicField } = await chain.sdk.client.client.core.getDynamicField({
      parentId,
      name: { type: keyType, bcs: fieldless },
    });
    if (valueName) {
      if (dynamicField.value.type !== (await chain.sdk.client.coreType("identity", valueName))) invalid();
      return AgentOperatorBcs.parse(dynamicField.value.bcs);
    }
    // The marker is a literal `true`; accepting another dynamic-field value
    // would turn an unrelated field into authority-looking UI.
    if (bcs.bool().parse(dynamicField.value.bcs) !== true) invalid();
    return true;
  } catch (error) {
    if (missingDynamicField(error, parentId, keyType, fieldless)) return null;
    throw error;
  }
}

export async function isAgentPairing(chain: ChainReadSession, requestId: string) {
  if (!id.test(requestId)) invalid();
  return Boolean(await marker(chain, requestId, "AgentPairingKey"));
}

function validRequest(request: ReturnType<typeof DevicePairingRequestBcs.parse>, requestId: string, humanId: string, organizationId: string) {
  if (
    request.id !== requestId ||
    request.human_id !== humanId ||
    request.organization_id !== organizationId ||
    !id.test(request.device) ||
    request.signing_public_key.length !== 32 ||
    request.encryption_public_key.length !== 32 ||
    request.status < 0 ||
    request.status > 3 ||
    (request.status === 1) !== (request.grant_id !== null)
  ) invalid();
  if (new Ed25519PublicKey(Uint8Array.from(request.signing_public_key)).toSuiAddress() !== request.device) invalid();
}

async function pendingPairings(chain: ChainReadSession, humanId: string, organizationId: string, nowMs: bigint, chainIdentifier: string) {
  const eventType = await chain.sdk.client.coreType("identity", "DevicePairingCreated");
  const requestIds = new Set<string>();
  let cursor: string | null = null;
  for (let pageNumber = 0; pageNumber < MAX_EVENT_PAGES; pageNumber++) {
    const page = await chain.sdk.client.client.core.listEvents({
      filter: { eventType },
      limit: 50,
      order: "descending",
      ...(cursor ? { before: cursor } : {}),
    });
    for (const event of page.events) {
      if (event.eventType !== eventType) invalid();
      const created = PairingCreatedBcs.parse(event.bcs);
      if (created.human_id === humanId && id.test(created.request_id)) requestIds.add(created.request_id);
      if (requestIds.size > MAX_PAIRINGS) throw new AgentOperatorChainError("directory_too_large");
    }
    if (!page.hasNextPage) break;
    if (!page.endCursor || page.endCursor === cursor) invalid();
    cursor = page.endCursor;
    if (pageNumber === MAX_EVENT_PAGES - 1) throw new AgentOperatorChainError("directory_too_large");
  }
  const rows: AgentPairing[] = [];
  for (const requestId of requestIds) {
    const request = await chain.sdk.identity.getDevicePairing(requestId);
    // Pairing records for other organizations are never exposed in this page.
    if (request.organization_id !== organizationId || request.human_id !== humanId) continue;
    validRequest(request, requestId, humanId, organizationId);
    if (!(await isAgentPairing(chain, requestId))) continue;
    if (request.status === 0 && BigInt(request.expires_at_ms) > nowMs) {
      const fingerprint = await pairingFingerprint(chainIdentifier, request);
      rows.push({ request, code: pairingCode(fingerprint) });
    }
  }
  return rows.sort((a, b) => Number(BigInt(a.request.expires_at_ms) - BigInt(b.request.expires_at_ms)));
}

async function operatorRows(
  chain: ChainReadSession,
  grants: readonly AgentOperatorRow["grant"][],
  humanId: string,
  humanGeneration: bigint | string | number,
  organizationId: string,
  nowMs: bigint,
) {
  const scoped = grants.filter((grant) =>
    grant.human_id === humanId && grant.org_scope === organizationId && id.test(grant.id) && id.test(grant.device),
  );
  const rows = await Promise.all(scoped.map(async (grant) => {
    const metadata = await marker(chain, grant.id, "AgentOperatorKey", "AgentOperator");
    if (!metadata) return null;
    if (metadata === true) invalid();
    const [balance, history] = await Promise.all([
      chain.sdk.client.client.core.getBalance({ owner: grant.device, coinType: "0x2::sui::SUI" }),
      chain.sdk.client.client.core.listTransactions({
        filter: { sender: grant.device }, limit: 10, order: "descending", include: { transaction: true },
      }),
    ]);
    return {
      grant,
      label: metadata.label,
      approvedBy: metadata.approved_by,
      balance: balance.balance.balance,
      activity: parseAgentActivity(history.transactions.map((result) =>
        result.$kind === "Transaction" ? result.Transaction : result.FailedTransaction,
      )),
      inactive: isExpiredOrRevoked(grant, humanGeneration, nowMs),
    } satisfies AgentOperatorRow;
  }));
  return rows.filter((row): row is AgentOperatorRow => row !== null);
}

/** Reconstruct the entire page from current localnet data.  It has no write
 * path and deliberately refuses testnet/mainnet, where this local-only UI is
 * not an authority surface. */
export async function readAgentOperatorDirectory(chain: ChainReadSession, organizationId: string): Promise<AgentOperatorDirectory> {
  assertLocalnet(chain);
  if (!id.test(organizationId)) invalid();
  const human = await chain.human();
  if (!human.human.organizations.includes(organizationId) || human.grants.value === null) invalid();
  const [pending, rows] = await Promise.all([
    pendingPairings(chain, human.human.id, organizationId, human.clockMs, human.chainIdentifier),
    operatorRows(chain, human.grants.value, human.human.id, human.human.generation, organizationId, human.clockMs),
  ]);
  await chain.checkNetwork();
  const active = rows.filter((row) => !row.inactive).sort((a, b) => Number(BigInt(a.grant.expires_at_ms) - BigInt(b.grant.expires_at_ms)));
  const inactive = rows.filter((row) => row.inactive).sort((a, b) => Number(BigInt(b.grant.expires_at_ms) - BigInt(a.grant.expires_at_ms)));
  return { nowMs: human.clockMs, pending, active, inactive };
}
