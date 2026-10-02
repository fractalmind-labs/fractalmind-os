import { Ed25519PublicKey } from "@mysten/sui/keypairs/ed25519";
import {
  CoordinatorBindingBcs,
  HostIndexBcs,
  HostInviteBcs,
  HostMembershipBcs,
  SelfPayTransactionManager,
  createHostInviteMaterial,
  encodeHostInviteCode,
  type SelfPayFeeQuote,
  type SelfPayTransactionOutcome,
  type TransactionJournal,
} from "@fractalmind-labs/fractalmind-sdk";
import { ChainReadSession, missingIndex } from "./chain";
import { DeviceIdentityVerifier, OrganizationBcs } from "./device-identity";
import { NativeDeviceSigner } from "./native-device";

export class HostAdmissionError extends Error {
  constructor(
    readonly code:
      | "invalid_input"
      | "invalid_source"
      | "state_changed"
      | "unavailable"
      | "confirmation_required"
      | "invalid_quote"
      | "sync_pending",
  ) {
    super(code);
  }
}
export type HostBinding = ReturnType<typeof CoordinatorBindingBcs.parse>;
export type HostInvite = ReturnType<typeof HostInviteBcs.parse>;
export type HostMember = ReturnType<typeof HostMembershipBcs.parse>;
export type HostOperation =
  | { kind: "binding"; endpoint: string; publicKey: string }
  | {
      kind: "invite";
      bindingId: string;
      ttlMinutes: 15 | 60 | 1440;
      membershipDays: number;
      observationHours: number;
    }
  | { kind: "revoke-invite"; targetId: string }
  | { kind: "revoke-member"; targetId: string };
export type HostDirectory = {
  bindings: HostBinding[];
  invitations: HostInvite[];
  memberships: HostMember[];
  clockMs: bigint;
  loadedAtMs: number;
};
const id = /^0x[0-9a-f]{64}$/;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const day = 86400000n;
function bad(): never {
  throw new HostAdmissionError("invalid_source");
}
/** Coordinator discovery is independent of the endpoint's authenticated live state. */
export function coordinatorInput(endpoint: string, publicKey: string) {
  if (!/^[0-9a-f]{64}$/.test(publicKey))
    throw new HostAdmissionError("invalid_input");
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new HostAdmissionError("invalid_input");
  }
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/" ||
    !["https:", "http:"].includes(url.protocol) ||
    (url.protocol === "http:" &&
      !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
  )
    throw new HostAdmissionError("invalid_input");
  const key = Uint8Array.from(publicKey.match(/../g)!, (x) => parseInt(x, 16));
  return {
    endpoint: url.origin,
    publicKey: key,
    address: new Ed25519PublicKey(key).toSuiAddress(),
  };
}
function invitationInput(input: Extract<HostOperation, { kind: "invite" }>) {
  if (
    !id.test(input.bindingId) ||
    ![15, 60, 1440].includes(input.ttlMinutes) ||
    !Number.isInteger(input.membershipDays) ||
    input.membershipDays < 1 ||
    input.membershipDays > 90 ||
    !Number.isInteger(input.observationHours) ||
    input.observationHours < 1 ||
    input.observationHours > input.membershipDays * 24
  )
    throw new HostAdmissionError("invalid_input");
  return input;
}
async function object(
  chain: ChainReadSession,
  objectId: string,
  module: string,
  kind: string,
) {
  if (!id.test(objectId)) bad();
  const { object } = await chain.sdk.client.client.core.getObject({
    objectId,
    include: { content: true },
  });
  if (
    object.objectId !== objectId ||
    object.type !== `${chain.sdk.client.typesPackageId}::${module}::${kind}` ||
    object.owner.$kind !== "Shared" ||
    !object.content ||
    !/^[1-9][0-9]*$/.test(object.version)
  )
    bad();
  return object;
}
/** Chain-only reconstruction. A failed index read is not an empty directory. */
export async function hostDirectory(
  chain: ChainReadSession,
  organizationId: string,
): Promise<HostDirectory> {
  await chain.checkNetwork();
  const human = await chain.human();
  if (!human.human.organizations.includes(organizationId)) bad();
  const before = await object(
    chain,
    organizationId,
    "organization",
    "Organization",
  );
  const org = OrganizationBcs.parse(before.content!);
  if (org.id !== organizationId || !org.is_active) bad();
  const readIndex = async () => {
    try {
      const { dynamicField } =
        await chain.sdk.client.client.core.getDynamicField({
          parentId: organizationId,
          name: {
            type: `${chain.sdk.client.typesPackageId}::host::HostIndexBinding`,
            bcs: new Uint8Array([0]),
          },
        });
      if (
        dynamicField.value.type !==
        `${chain.sdk.client.typesPackageId}::host::HostIndex`
      )
        bad();
      const value = HostIndexBcs.parse(dynamicField.value.bcs);
      for (const ids of [value.bindings, value.invitations, value.memberships])
        if (
          ids.length > 1000 ||
          new Set(ids).size !== ids.length ||
          ids.some((x) => !id.test(x))
        )
          bad();
      return value;
    } catch (e) {
      if (
        missingIndex(
          e,
          organizationId,
          `${chain.sdk.client.typesPackageId}::host::HostIndexBinding`,
        )
      )
        return null;
      throw e;
    }
  };
  const index = await readIndex();
  const scoped = async <T extends { id: string; org_id: string }>(
    ids: string[],
    kind: string,
    parse: (bytes: Uint8Array) => T,
  ) =>
    Promise.all(
      ids.map(async (objectId) => {
        const source = await object(chain, objectId, "host", kind);
        const value = parse(source.content!);
        if (value.id !== objectId || value.org_id !== organizationId) bad();
        return value;
      }),
    );
  const [bindings, invitations, memberships] = await Promise.all([
    scoped(index?.bindings ?? [], "CoordinatorBinding", (bytes) =>
      CoordinatorBindingBcs.parse(bytes),
    ),
    scoped(index?.invitations ?? [], "HostInvite", (bytes) =>
      HostInviteBcs.parse(bytes),
    ),
    scoped(index?.memberships ?? [], "HostMembership", (bytes) =>
      HostMembershipBcs.parse(bytes),
    ),
  ]);
  for (const b of bindings) {
    if (b.public_key.length !== 32 || BigInt(b.version) < 1n) bad();
    const input = coordinatorInput(
      b.endpoint,
      b.public_key.map((n) => n.toString(16).padStart(2, "0")).join(""),
    );
    if (
      input.address !== b.coordinator_address ||
      input.endpoint !== b.endpoint
    )
      bad();
  }
  for (const invite of invitations) {
    if (
      !bindings.some((b) => b.id === invite.coordinator_binding) ||
      invite.proof_public_key.length !== 32 ||
      invite.template_version !== "1" ||
      invite.max_uses !== 1 ||
      invite.uses > 1 ||
      !id.test(invite.issuer_human) ||
      !id.test(invite.issuer_grant) ||
      !id.test(invite.issuer_device)
    )
      bad();
  }
  for (const member of memberships) {
    if (
      !bindings.some((b) => b.id === member.coordinator_binding) ||
      member.host_public_key.length !== 32 ||
      member.encryption_public_key.length !== 32 ||
      new Ed25519PublicKey(
        Uint8Array.from(member.host_public_key),
      ).toSuiAddress() !== member.host_address ||
      !id.test(member.source_invite) ||
      !id.test(member.observation_capability)
    )
      bad();
  }
  const after = await object(
    chain,
    organizationId,
    "organization",
    "Organization",
  );
  if (
    before.version !== after.version ||
    JSON.stringify(index) !== JSON.stringify(await readIndex())
  )
    throw new HostAdmissionError("state_changed");
  await chain.checkNetwork();
  return {
    bindings,
    invitations,
    memberships,
    clockMs: human.clockMs,
    loadedAtMs: human.loadedAtMs,
  };
}
type Plan = {
  operation: HostOperation;
  authority: string;
  targetPin: string;
  expiresAtMs?: string;
  requestId: string;
};
/** Long-lived Human/device keys remain native. Only the single-use invitation
 * bearer secret lives transiently here; neither the journal nor chain stores it. */
export class HostAdmission {
  readonly manager: SelfPayTransactionManager;
  private verifier: DeviceIdentityVerifier;
  private plans = new Map<SelfPayFeeQuote, Plan>();
  private secrets = new Map<
    string,
    ReturnType<typeof createHostInviteMaterial>
  >();
  constructor(
    readonly chain: ChainReadSession,
    readonly device: NativeDeviceSigner,
    readonly grantId: string,
    readonly organizationId: string,
    journal: TransactionJournal,
  ) {
    if (!id.test(organizationId)) throw new HostAdmissionError("invalid_input");
    this.verifier = new DeviceIdentityVerifier(chain, device, grantId);
    this.manager = new SelfPayTransactionManager({
      client: chain.sdk.client.client,
      network: chain.profile.network,
      signer: device,
      journal,
    });
  }
  private request(attemptId: string) {
    if (!uuid.test(attemptId)) throw new HostAdmissionError("invalid_input");
    return `host:${attemptId}`;
  }
  async query(attemptId: string) {
    await this.chain.checkNetwork();
    return this.manager.query(this.request(attemptId));
  }
  directory() {
    return hostDirectory(this.chain, this.organizationId);
  }
  private async target(operation: HostOperation) {
    if (operation.kind === "binding") return "";
    const directory = await this.directory();
    if (operation.kind === "invite") {
      const b = directory.bindings.find((b) => b.id === operation.bindingId);
      if (!b || b.revoked) throw new HostAdmissionError("unavailable");
      return JSON.stringify(b);
    }
    const value =
      operation.kind === "revoke-invite"
        ? directory.invitations.find((i) => i.id === operation.targetId)
        : directory.memberships.find((m) => m.id === operation.targetId);
    if (!value || value.revoked || ("uses" in value && value.uses !== 0))
      throw new HostAdmissionError("unavailable");
    return JSON.stringify(value);
  }
  async prepare(
    operation: HostOperation,
    attemptId: string,
    confirmed: boolean,
  ) {
    const requestId = this.request(attemptId);
    // A previously submitted operation is never silently replaced, even if its
    // authority/source has since disappeared or the invitation secret was lost.
    const prior = await this.query(attemptId);
    if (prior) return prior;
    if (!confirmed) throw new HostAdmissionError("confirmation_required");
    // Requoting discards the prior unsubmitted plan and its bearer secret. An
    // older displayed quote must never submit after its material was replaced.
    for (const [quote, plan] of this.plans) {
      if (plan.requestId === requestId) this.cancel(quote);
    }
    operation = structuredClone(operation);
    if (operation.kind === "invite") invitationInput(operation);
    else if (operation.kind === "binding")
      coordinatorInput(operation.endpoint, operation.publicKey);
    else if (
      !["revoke-invite", "revoke-member"].includes(operation.kind) ||
      !id.test(operation.targetId)
    )
      throw new HostAdmissionError("invalid_input");
    const authority = await this.verifier.verifyOrganization(
      this.organizationId,
      "manage_hosts",
    );
    const targetPin = await this.target(operation);
    const args = {
      organizationId: this.organizationId,
      humanId: this.chain.profile.humanId,
      grantId: this.grantId,
    };
    const api = this.chain.sdk.host;
    let expiresAtMs: string | undefined;
    let transaction;
    this.dropSecret(requestId);
    if (operation.kind === "binding") {
      transaction = api.createCoordinatorBinding({
        ...args,
        ...coordinatorInput(operation.endpoint, operation.publicKey),
      });
    } else if (operation.kind === "invite") {
      const material = createHostInviteMaterial(this.chain.profile.network);
      this.secrets.set(requestId, material);
      expiresAtMs = (
        authority.clockMs +
        BigInt(operation.ttlMinutes) * 60000n
      ).toString();
      transaction = api.createInvite({
        ...args,
        bindingId: operation.bindingId,
        proofPublicKey: material.publicKey,
        expiresAtMs,
        membershipTtlMs: BigInt(operation.membershipDays) * day,
        capabilityTtlMs: BigInt(operation.observationHours) * 3600000n,
      });
    } else if (operation.kind === "revoke-invite")
      transaction = api.revokeInvite({ ...args, inviteId: operation.targetId });
    else
      transaction = api.revokeMembership({
        ...args,
        membershipId: operation.targetId,
      });
    try {
      const after = await this.verifier.verifyOrganization(
        this.organizationId,
        "manage_hosts",
      );
      if (
        !authority.authorityPin ||
        authority.authorityPin !== after.authorityPin ||
        targetPin !== (await this.target(operation))
      )
        throw new HostAdmissionError("state_changed");
      const quote = await this.manager.prepare({
        requestId,
        transaction,
        gasBudget: 200000000n,
      });
      this.plans.set(quote, {
        operation,
        authority: after.authorityPin!,
        targetPin,
        expiresAtMs,
        requestId,
      });
      return quote;
    } catch (e) {
      this.dropSecret(requestId);
      throw e;
    }
  }
  async submit(quote: SelfPayFeeQuote) {
    const plan = this.plans.get(quote);
    if (!plan || quote.requestId !== plan.requestId)
      throw new HostAdmissionError("invalid_quote");
    const prior = await this.manager.query(plan.requestId);
    if (prior) return prior;
    const authority = await this.verifier.verifyOrganization(
      this.organizationId,
      "manage_hosts",
    );
    if (
      authority.authorityPin !== plan.authority ||
      (await this.target(plan.operation)) !== plan.targetPin ||
      (plan.expiresAtMs && BigInt(plan.expiresAtMs) <= authority.clockMs)
    )
      throw new HostAdmissionError("state_changed");
    const outcome = await this.manager.submit(quote);
    if (outcome.status === "failed") this.dropSecret(plan.requestId);
    return outcome;
  }
  /** Exact receipt output versions can lag ledger reads; polling is read-only. */
  async awaitVisible(outcome: SelfPayTransactionOutcome, attempts = 40) {
    if (outcome.status !== "confirmed") return false;
    if (
      !outcome.transaction?.effects ||
      !Number.isInteger(attempts) ||
      attempts < 1 ||
      attempts > 40
    )
      bad();
    const writes = outcome.transaction.effects.changedObjects.filter(
      (x) => x.outputState === "ObjectWrite" && x.outputVersion,
    );
    if (!writes.length) bad();
    await this.chain.checkNetwork();
    for (let n = 0; n < attempts; n++) {
      let ready = true;
      for (const write of writes) {
        try {
          const { object } = await this.chain.sdk.client.client.core.getObject({
            objectId: write.objectId,
          });
          if (object.objectId !== write.objectId) bad();
          if (BigInt(object.version) < BigInt(write.outputVersion!))
            ready = false;
        } catch (e) {
          if (
            typeof e === "object" &&
            e &&
            "reason" in e &&
            e.reason === "notFound" &&
            "objectId" in e &&
            e.objectId === write.objectId
          )
            ready = false;
          else throw e;
        }
      }
      if (ready) {
        await this.chain.checkNetwork();
        return true;
      }
      if (n + 1 < attempts)
        await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return false;
  }
  async createdInvite(outcome: SelfPayTransactionOutcome) {
    if (!(await this.awaitVisible(outcome)))
      throw new HostAdmissionError("sync_pending");
    const directory = await this.directory();
    const created = outcome
      .transaction!.effects.changedObjects.filter(
        (x) => x.idOperation === "Created",
      )
      .map((x) => x.objectId);
    const matches = directory.invitations.filter((i) => created.includes(i.id));
    if (matches.length !== 1) bad();
    const invite = matches[0],
      material = this.secrets.get(outcome.requestId);
    if (!material) return { invite, code: null };
    if (
      invite.issuer_human !== this.chain.profile.humanId ||
      invite.issuer_grant !== this.grantId ||
      invite.issuer_device !== this.device.device.address ||
      !invite.proof_public_key.every(
        (byte, i) => material.publicKey[i] === byte,
      )
    )
      bad();
    // Consumption, expiry or revocation must not expose a no-longer-usable code.
    const code =
      invite.revoked ||
      invite.uses !== 0 ||
      BigInt(invite.expires_at_ms) <= directory.clockMs
        ? null
        : encodeHostInviteCode(
            this.chain.profile.network,
            invite.id,
            material.entropy,
          );
    return { invite, code };
  }
  private dropSecret(requestId: string) {
    this.secrets.get(requestId)?.entropy.fill(0);
    this.secrets.delete(requestId);
  }
  cancel(quote: SelfPayFeeQuote) {
    const plan = this.plans.get(quote);
    if (plan) this.dropSecret(plan.requestId);
    this.plans.delete(quote);
  }
  dispose() {
    for (const key of this.secrets.keys()) this.dropSecret(key);
    this.plans.clear();
  }
}
