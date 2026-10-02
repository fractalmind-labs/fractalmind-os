import { fromBase64, toBase64 } from "@mysten/sui/utils";
import { bcs } from "@mysten/sui/bcs";
import {
  bytesToHex,
  nodeCommandIntentHash,
  verifySignedNodeCommand,
  type SignedNodeCommand,
  type WrappedCommandResultKey,
} from "@fractalmind-labs/fractalmind-sdk";
import { ChainReadSession } from "./chain";
import { DeviceIdentityVerifier } from "./device-identity";
import { hostDirectory } from "./host-admission";
import { managedInstance } from "./agent-import";
import { call, NativeDeviceSigner, type NativeInvoke } from "./native-device";

export class CommandResultError extends Error {
  constructor(
    readonly code:
      | "invalid_command"
      | "invalid_source"
      | "state_changed"
      | "command_expired"
      | "invalid_envelope",
  ) {
    super(code);
  }
}
export type CommandResultTarget = {
  command: SignedNodeCommand;
  membershipId: string;
  bindingId: string;
  managedAgentId: string;
};
const id = /^0x[0-9a-f]{64}$/;

/** Native command-result preparation for fee-quoted App transactions. No
 * organization key export, persistence, signing, broadcast or Host dispatch.
 * Returned preflight must also run after transaction signing, before broadcast.
 * OKR review/continuation rules remain the caller's additional responsibility. */
export class NativeCommandResults {
  private readonly verifier: DeviceIdentityVerifier;
  constructor(
    readonly chain: ChainReadSession,
    readonly signer: NativeDeviceSigner,
    readonly grantId: string,
    readonly organizationId: string,
    private readonly invoke: NativeInvoke,
  ) {
    if (!id.test(organizationId))
      throw new CommandResultError("invalid_source");
    this.verifier = new DeviceIdentityVerifier(chain, signer, grantId);
  }
  private async source(input: CommandResultTarget) {
    const c = input.command;
    const review =
      c.action === "status" && Object.hasOwn(c.payload, "handover_review");
    const action = review
      ? "approve"
      : c.scope === "control"
        ? "operate"
        : "read";
    const authority = await this.verifier.verifyOrganization(
      this.organizationId,
      action,
    );
    if (
      review &&
      !(["read", "operate", "approve", "manage_hosts"] as const).every((a) =>
        authority.actions.includes(a),
      )
    )
      throw new CommandResultError("invalid_source");
    const directory = await hostDirectory(this.chain, this.organizationId);
    if (
      BigInt(c.expires_at_ms) <= directory.clockMs ||
      Date.now() >= c.expires_at_ms
    )
      throw new CommandResultError("command_expired");
    const member = directory.memberships.find(
      (m) =>
        m.id === input.membershipId &&
        !m.revoked &&
        m.host_address === c.target.node_id &&
        m.coordinator_binding === input.bindingId &&
        BigInt(m.expires_at_ms) > directory.clockMs,
    );
    const binding = directory.bindings.find(
      (b) => b.id === input.bindingId && !b.revoked,
    );
    if (!member || !binding || member.encryption_public_key.length !== 32)
      throw new CommandResultError("invalid_source");
    if (!directory.activeHostsTableId)
      throw new CommandResultError("invalid_source");
    const { dynamicField } =
      await this.chain.sdk.client.client.core.getDynamicField({
        parentId: directory.activeHostsTableId,
        name: {
          type: "address",
          bcs: bcs.Address.serialize(member.host_address).toBytes(),
        },
      });
    if (
      !["0x2::object::ID", `0x${"2".padStart(64, "0")}::object::ID`].includes(
        dynamicField.value.type,
      ) ||
      bcs.Address.parse(dynamicField.value.bcs) !== member.id
    )
      throw new CommandResultError("invalid_source");
    const managed = await managedInstance(
      this.chain,
      this.organizationId,
      c.target.node_id,
      c.target.agent_id!,
    );
    if (
      !managed ||
      managed.id !== input.managedAgentId ||
      managed.membership_id !== member.id ||
      managed.revoked
    )
      throw new CommandResultError("invalid_source");
    const index = await this.chain.sdk.productRecord.listCurrent(
      this.organizationId,
      null,
      1,
    );
    if (
      !/^[1-9][0-9]*$/.test(index.keyVersion) ||
      BigInt(index.keyVersion) > 0xffffffffffffffffn
    )
      throw new CommandResultError("invalid_source");
    return {
      authority,
      member,
      keyVersion: index.keyVersion,
      pin: JSON.stringify([
        authority.authorityPin,
        directory.chainIdentifier,
        directory.activeHostsTableId,
        directory.instancesTableId,
        member,
        binding,
        managed,
        index.keyVersion,
      ]),
    };
  }
  async prepare(raw: CommandResultTarget) {
    const input = structuredClone(raw),
      c = input.command;
    if (
      ![
        input.membershipId,
        input.bindingId,
        input.managedAgentId,
        c?.target?.node_id,
        c?.capability?.id,
      ].every((v) => typeof v === "string" && id.test(v)) ||
      c.signer !== this.signer.device.address ||
      c.target.organization_id !== this.organizationId ||
      typeof c.target.agent_id !== "string" ||
      !/^(native|tmux)-[0-9a-f]{64}$/.test(c.target.agent_id) ||
      !Number.isSafeInteger(c.expires_at_ms) ||
      !(
        (c.scope === "observation" &&
          [
            "status",
            "inventory",
            "monitor",
            "logs",
            "health",
            "availability",
          ].includes(c.action)) ||
        (c.scope === "control" &&
          ["assign", "start", "stop", "direct.message"].includes(c.action))
      )
    )
      throw new CommandResultError("invalid_command");
    try {
      await verifySignedNodeCommand(c);
    } catch {
      throw new CommandResultError("invalid_command");
    }
    const before = await this.source(input),
      fingerprint = bytesToHex(nodeCommandIntentHash(c));
    const result = await call(
      this.invoke,
      "fm_device_wrap_command_result_key",
      {
        profile: this.signer.device.profile,
        request: JSON.stringify({
          network: this.chain.profile.network,
          encryptedKeys: before.authority.encryptedKeys,
          organizationId: this.organizationId,
          capabilityId: c.capability.id,
          membershipId: before.member.id,
          intentHash: fingerprint,
          keyVersion: before.keyVersion,
          hostAddress: before.member.host_address,
          hostSigningPublicKey: toBase64(
            Uint8Array.from(before.member.host_public_key),
          ),
          hostEncryptionPublicKey: toBase64(
            Uint8Array.from(before.member.encryption_public_key),
          ),
        }),
      },
    );
    let wrapped: Uint8Array;
    try {
      if (typeof result !== "string" || result.length !== 176)
        throw new Error();
      wrapped = fromBase64(result);
      if (
        wrapped.length !== 132 ||
        toBase64(wrapped) !== result ||
        new TextDecoder().decode(wrapped.slice(0, 4)) !== "FMW1" ||
        new TextDecoder().decode(wrapped.slice(68, 72)) !== "FME1"
      )
        throw new Error();
    } catch {
      throw new CommandResultError("invalid_envelope");
    }
    const assertCurrent = async () => {
      if ((await this.source(input)).pin !== before.pin)
        throw new CommandResultError("state_changed");
    };
    await assertCurrent();
    const resultKey: WrappedCommandResultKey = {
      wrappedKey: wrapped,
      keyVersion: before.keyVersion,
      organizationId: this.organizationId,
      capabilityId: c.capability.id,
      membershipId: before.member.id,
      hostAddress: before.member.host_address,
      hostEncryptionPublicKey: Uint8Array.from(
        before.member.encryption_public_key,
      ),
      intentHash: fingerprint,
    };
    const transaction = await this.chain.sdk.nodeExecution.prepareCommand({
      humanId: this.chain.profile.humanId,
      grantId: this.grantId,
      membershipId: input.membershipId,
      bindingId: input.bindingId,
      managedAgentId: input.managedAgentId,
      command: c,
      resultKey,
    });
    await assertCurrent();
    return Object.freeze({ transaction, assertCurrent });
  }
}
