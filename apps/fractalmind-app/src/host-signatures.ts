import { bcs } from "@mysten/sui/bcs";
import { Ed25519PublicKey } from "@mysten/sui/keypairs/ed25519";
import { fromBase64, toBase64, normalizeSuiAddress } from "@mysten/sui/utils";
import { ChainReadSession } from "./chain";
import { hostDirectory } from "./host-admission";
import { coordinatorHosts, type CoordinatorHost } from "./host-observations";
import { agentDiscovery, type AgentDiscovery } from "./agent-discovery";

export class HostObservationError extends Error {
  constructor(
    readonly code:
      | "invalid_host_signature"
      | "invalid_host_scope"
      | "host_source_unavailable"
      | "host_observation_expired",
  ) {
    super(code);
  }
}
export type VerifiedHostObservation = {
  address: string;
  state: "verified" | "unknown" | "expired";
  reason?: HostObservationError["code"];
  observation: CoordinatorHost | null;
  membershipId: string | null;
  expiresAtMs: number | null;
  freshUntilMs: number | null;
  discovery: AgentDiscovery | null;
  nativeDiscovery?: AgentDiscovery | null;
};
type Signed = {
  format: number;
  chain_identifier: string;
  organization_id: string;
  membership_id: string;
  membership_version: string;
  binding_id: string;
  binding_version: string;
  host_address: string;
  session_nonce: string;
  sequence: number;
  observed_at_ms: number;
  expires_at_ms: number;
  body: string;
  signature: string;
};
const id = /^0x[0-9a-f]{64}$/;
const version = /^[1-9][0-9]{0,19}$/;
const maximum = 256 * 1024;
function bad(code: HostObservationError["code"]): never {
  throw new HostObservationError(code);
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    bad("invalid_host_signature");
  return value as Record<string, unknown>;
}
function hex(value: string, size: number) {
  if (!new RegExp(`^[0-9a-f]{${size * 2}}$`).test(value))
    bad("invalid_host_signature");
  return Uint8Array.from(value.match(/../g)!, (s) => parseInt(s, 16));
}
function signed(value: unknown): Signed {
  const s = object(value) as unknown as Signed;
  if (
    s.format !== 1 ||
    !/^[A-Za-z0-9]{1,64}$/.test(s.chain_identifier) ||
    [s.organization_id, s.membership_id, s.binding_id, s.host_address].some(
      (x) => typeof x !== "string" || !id.test(x),
    ) ||
    [s.membership_version, s.binding_version].some(
      (x) =>
        typeof x !== "string" ||
        !version.test(x) ||
        BigInt(x) > 18446744073709551615n,
    ) ||
    typeof s.session_nonce !== "string" ||
    !/^[0-9a-f]{64}$/.test(s.session_nonce) ||
    !Number.isSafeInteger(s.sequence) ||
    s.sequence < 1 ||
    !Number.isSafeInteger(s.observed_at_ms) ||
    s.observed_at_ms < 0 ||
    !Number.isSafeInteger(s.expires_at_ms) ||
    s.expires_at_ms <= s.observed_at_ms ||
    s.expires_at_ms - s.observed_at_ms > 60_000 ||
    typeof s.body !== "string" ||
    s.body.length > Math.ceil(maximum / 3) * 4 ||
    typeof s.signature !== "string"
  )
    bad("invalid_host_signature");
  return s;
}
async function verifyBytes(s: Signed, publicKey: number[]) {
  if (publicKey.length !== 32) bad("invalid_host_signature");
  const key = new Ed25519PublicKey(Uint8Array.from(publicKey));
  if (key.toSuiAddress() !== s.host_address) bad("invalid_host_signature");
  let raw: Uint8Array;
  try {
    raw = fromBase64(s.body);
    if (raw.length > maximum || toBase64(raw) !== s.body) throw new Error();
  } catch {
    bad("invalid_host_signature");
  }
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new Uint8Array(raw!)),
  );
  const hash = Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join(
    "",
  );
  const text = [
    "FM-HOST-OBSERVATION",
    "1",
    s.chain_identifier,
    s.organization_id,
    s.membership_id,
    s.membership_version,
    s.binding_id,
    s.binding_version,
    s.host_address,
    s.session_nonce,
    s.sequence,
    s.observed_at_ms,
    s.expires_at_ms,
    hash,
  ].join(":");
  if (!(await key.verify(new TextEncoder().encode(text), hex(s.signature, 64))))
    bad("invalid_host_signature");
  try {
    return object(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw!)),
    );
  } catch {
    bad("invalid_host_signature");
  }
}

/** Independently verifies each Host. A forged or expired row cannot conceal
 * other current Hosts, or expose unverified resource values as Host evidence. */
export async function verifyHostObservations(
  chain: ChainReadSession,
  organizationId: string,
  bindingId: string,
  value: unknown,
): Promise<VerifiedHostObservation[]> {
  const directory = await hostDirectory(chain, organizationId);
  const binding = directory.bindings.find(
    (b) => b.id === bindingId && !b.revoked,
  );
  if (
    !binding ||
    directory.clockMs < 0n ||
    directory.clockMs > BigInt(Number.MAX_SAFE_INTEGER)
  )
    bad("invalid_host_scope");
  const rows = coordinatorHosts(value, Number(directory.clockMs)),
    sources = (value as { sentinels: Record<string, unknown>[] }).sentinels;
  const pins = new Map<string, string>();
  const pointer = async (address: string) => {
    if (!directory.activeHostsTableId) bad("invalid_host_scope");
    const { dynamicField } = await chain.sdk.client.client.core.getDynamicField(
      {
        parentId: directory.activeHostsTableId!,
        name: {
          type: "address",
          bcs: bcs.Address.serialize(address).toBytes(),
        },
      },
    );
    if (dynamicField.value.type !== `${normalizeSuiAddress("0x2")}::object::ID`)
      bad("invalid_host_scope");
    return bcs.Address.parse(dynamicField.value.bcs);
  };
  const results: VerifiedHostObservation[] = [];
  // Limit concurrent RPC work and memory; never trust Coordinator-supplied URLs.
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    try {
      const s = signed(sources[index].host_observation);
      if (
        s.chain_identifier !== directory.chainIdentifier ||
        s.organization_id !== organizationId ||
        s.binding_id !== bindingId ||
        s.binding_version !== binding.version ||
        s.host_address !== row.address
      )
        bad("invalid_host_scope");
      const member = directory.memberships.find(
        (m) =>
          m.id === s.membership_id &&
          m.host_address === row.address &&
          m.coordinator_binding === bindingId,
      );
      if (
        !member ||
        member.revoked ||
        member.version !== s.membership_version ||
        BigInt(member.expires_at_ms) <= directory.clockMs ||
        BigInt(s.expires_at_ms) > BigInt(member.expires_at_ms) ||
        (await pointer(row.address)) !== member.id
      )
        bad("invalid_host_scope");
      const body = await verifyBytes(s, member.host_public_key);
      if (s.observed_at_ms > Number(directory.clockMs) + 5_000)
        bad("invalid_host_scope");
      const wallAge = BigInt(Math.max(0, Date.now() - directory.loadedAtMs));
      if (BigInt(s.expires_at_ms) <= directory.clockMs + wallAge)
        bad("host_observation_expired");
      if (
        (!Array.isArray(body.agents) && body.agents !== null) ||
        (Array.isArray(body.agents) && body.agents.length > 1000) ||
        body.host_id !== row.address ||
        typeof body.timestamp !== "string" ||
        Date.parse(body.timestamp) !== s.observed_at_ms
      )
        bad("invalid_host_signature");
      const parsed = coordinatorHosts(
        {
          sentinels: [
            {
              id: row.address,
              host_id: body.host_id,
              hostname: body.hostname,
              last_heartbeat: body.timestamp,
              agent_count: Array.isArray(body.agents) ? body.agents.length : 0,
              system: body.system,
            },
          ],
          count: 1,
        },
        Number(directory.clockMs),
      )[0];
      pins.set(member.id, JSON.stringify(member));
      results.push({
        address: row.address,
        state: "verified",
        observation: parsed,
        membershipId: member.id,
        expiresAtMs: s.expires_at_ms,
        freshUntilMs: null,
        nativeDiscovery: await agentDiscovery(
          body.native_discovery,
          s.observed_at_ms,
          s.expires_at_ms,
          "native",
        ),
        discovery: await agentDiscovery(
          body.discovery,
          s.observed_at_ms,
          s.expires_at_ms,
        ),
      });
    } catch (e) {
      const reason =
        e instanceof HostObservationError ? e.code : "host_source_unavailable";
      results.push({
        address: row.address,
        state: reason === "host_observation_expired" ? "expired" : "unknown",
        reason,
        observation: null,
        membershipId: null,
        expiresAtMs: null,
        freshUntilMs: null,
        discovery: null,
        nativeDiscovery: null,
      });
    }
  }
  const after = await hostDirectory(chain, organizationId);
  const latest = after.bindings.find((b) => b.id === bindingId);
  if (
    JSON.stringify(latest) !== JSON.stringify(binding) ||
    after.activeHostsTableId !== directory.activeHostsTableId
  )
    bad("invalid_host_scope");
  for (const result of results) {
    if (result.state !== "verified") continue;
    const member = after.memberships.find((m) => m.id === result.membershipId);
    try {
      if (
        !member ||
        pins.get(member.id) !== JSON.stringify(member) ||
        (await pointer(result.address)) !== member.id
      )
        bad("invalid_host_scope");
      if (
        BigInt(result.expiresAtMs!) <=
        after.clockMs + BigInt(Math.max(0, Date.now() - after.loadedAtMs))
      )
        bad("host_observation_expired");
      result.freshUntilMs =
        Date.now() +
        Number(
          BigInt(result.expiresAtMs!) -
            after.clockMs -
            BigInt(Math.max(0, Date.now() - after.loadedAtMs)),
        );
      for (const discovery of [result.discovery, result.nativeDiscovery]) {
        if (
          discovery?.expiresAtMs !== null &&
          discovery?.expiresAtMs !== undefined
        ) {
          const remaining =
            BigInt(discovery.expiresAtMs) -
            after.clockMs -
            BigInt(Math.max(0, Date.now() - after.loadedAtMs));
          if (remaining <= 0n) {
            discovery.state = "expired";
            discovery.instances = [];
          } else discovery.freshUntilMs = Date.now() + Number(remaining);
        }
      }
    } catch (e) {
      result.state =
        e instanceof HostObservationError &&
        e.code === "host_observation_expired"
          ? "expired"
          : "unknown";
      result.reason =
        e instanceof HostObservationError ? e.code : "host_source_unavailable";
      result.observation = null;
      result.expiresAtMs = null;
      result.membershipId = null;
      result.freshUntilMs = null;
      result.discovery = null;
      result.nativeDiscovery = null;
    }
  }
  return results;
}
