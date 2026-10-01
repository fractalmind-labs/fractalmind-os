import { bcs } from "@mysten/sui/bcs";
import { toBase64, normalizeSuiAddress } from "@mysten/sui/utils";
import {
  DeviceGrantBcs,
  HumanIdentityBcs,
  IdentityRegistryBcs,
  DEVICE_ACTIONS,
  type DeviceAction,
} from "@fractalmind-labs/fractalmind-sdk";
import { ChainReadSession } from "./chain";
import { NativeDeviceSigner } from "./native-device";

/** This verifies possession + a current device grant. Organization role and
 * action-specific resource checks still apply independently to each operation. */
export class DeviceIdentityError extends Error {
  constructor(
    public readonly code:
      | "invalid_source"
      | "invalid_grant"
      | "grant_expired"
      | "state_changed",
  ) {
    super(code);
    this.name = "DeviceIdentityError";
  }
}
const ClockBcs = bcs.struct("Clock", {
  id: bcs.Address,
  timestamp_ms: bcs.u64(),
});
const TableBcs = bcs.struct("Table", { id: bcs.Address, size: bcs.u64() });
const OrganizationBcs = bcs.struct("Organization", {
  id: bcs.Address,
  name: bcs.string(),
  description: bcs.string(),
  admin: bcs.Address,
  is_active: bcs.bool(),
  agents: TableBcs,
  agent_count: bcs.u64(),
  tasks: TableBcs,
  task_count: bcs.u64(),
  parent_org: bcs.option(bcs.Address),
  child_orgs: TableBcs,
  child_org_count: bcs.u64(),
  depth: bcs.u64(),
  created_at: bcs.u64(),
});
const OrgRoleBcs = bcs.struct("OrgRole", {
  owner_human: bcs.Address,
  admin: bcs.bool(),
  active: bcs.bool(),
  version: bcs.u64(),
});
export class DeviceIdentityVerifier {
  constructor(
    readonly chain: ChainReadSession,
    readonly signer: NativeDeviceSigner,
    readonly grantId: string,
  ) {
    if (!/^0x[0-9a-f]{64}$/.test(grantId))
      throw new DeviceIdentityError("invalid_grant");
  }
  private async snapshot(
    organizationId?: string,
    action: DeviceAction = "read",
  ) {
    const sdk = this.chain.sdk,
      core = sdk.client.client.core;
    const chainIdentifier = await this.chain.checkNetwork();
    const registryId = await sdk.identity.resolveRegistry(
      this.chain.profile.registryId,
    );
    const fetch = async (id: string, type: string) => {
      const { object } = await core.getObject({
        objectId: id,
        include: { content: true },
      });
      if (
        object.objectId !== id ||
        object.type !== type ||
        object.owner.$kind !== "Shared" ||
        !object.content ||
        !/^[1-9][0-9]*$/.test(object.version)
      )
        throw new DeviceIdentityError("invalid_source");
      return object;
    };
    const prefix = `${sdk.client.typesPackageId}::identity::`;
    const [registryObject, humanObject, grantObject, clockObject] =
      await Promise.all([
        fetch(registryId, prefix + "IdentityRegistry"),
        fetch(this.chain.profile.humanId, prefix + "HumanIdentity"),
        fetch(this.grantId, prefix + "DeviceGrant"),
        fetch(
          normalizeSuiAddress("0x6"),
          `${normalizeSuiAddress("0x2")}::clock::Clock`,
        ),
      ]);
    const registry = IdentityRegistryBcs.parse(registryObject.content!);
    const human = HumanIdentityBcs.parse(humanObject.content!);
    const grant = DeviceGrantBcs.parse(grantObject.content!);
    const clock = ClockBcs.parse(clockObject.content!);
    if (
      registry.id !== registryId ||
      registry.protocol_registry !== this.chain.profile.registryId ||
      human.id !== humanObject.objectId ||
      human.registry_id !== registryId ||
      human.network !== this.chain.profile.network ||
      grant.id !== this.grantId ||
      clock.id !== clockObject.objectId
    )
      throw new DeviceIdentityError("invalid_source");
    if (
      grant.human_id !== human.id ||
      !human.grants.includes(grant.id) ||
      grant.device !== this.signer.device.address ||
      grant.revoked ||
      grant.generation !== human.generation ||
      toBase64(Uint8Array.from(grant.encryption_public_key)) !==
        this.signer.device.encryptionPublicKey ||
      !grant.actions.includes(DEVICE_ACTIONS.read) ||
      !grant.actions.includes(DEVICE_ACTIONS[action])
    )
      throw new DeviceIdentityError("invalid_grant");
    if (BigInt(grant.expires_at_ms) <= BigInt(clock.timestamp_ms))
      throw new DeviceIdentityError("grant_expired");
    // Pin mutable inputs across dependent reads. Clock naturally advances and
    // is checked on the second snapshot rather than included in this pin.
    let organizationPin: unknown = null;
    if (organizationId) {
      if (
        !/^0x[0-9a-f]{64}$/.test(organizationId) ||
        (grant.org_scope !== null && grant.org_scope !== organizationId) ||
        !human.organizations.includes(organizationId)
      )
        throw new DeviceIdentityError("invalid_grant");
      const orgObject = await fetch(
        organizationId,
        `${sdk.client.typesPackageId}::organization::Organization`,
      );
      const org = OrganizationBcs.parse(orgObject.content!);
      const { dynamicField } = await core.getDynamicField({
        parentId: human.roles.id,
        name: {
          type: "0x2::object::ID",
          bcs: bcs.Address.serialize(organizationId).toBytes(),
        },
      });
      if (dynamicField.value.type !== prefix + "OrgRole")
        throw new DeviceIdentityError("invalid_source");
      const role = OrgRoleBcs.parse(dynamicField.value.bcs);
      if (
        org.id !== organizationId ||
        !org.is_active ||
        !role.active ||
        ((action === "approve" || action === "manage_hosts") && !role.admin) ||
        role.owner_human !== org.admin ||
        BigInt(role.version) < 1n
      )
        throw new DeviceIdentityError("invalid_grant");
      organizationPin = [organizationId, orgObject.version, role];
    }
    const versions = JSON.stringify([
      chainIdentifier,
      registryObject.version,
      humanObject.version,
      grantObject.version,
      organizationPin,
    ]);
    await this.chain.checkNetwork();
    return {
      human,
      grant,
      clockMs: BigInt(clock.timestamp_ms),
      chainIdentifier,
      versions,
    };
  }
  async verify() {
    return this.verifyScoped();
  }
  /** Fresh organization role and scope checks, not an inference from possession. */
  async verifyOrganization(
    organizationId: string,
    action: DeviceAction = "read",
  ) {
    return this.verifyScoped(organizationId, action);
  }
  private async verifyScoped(
    organizationId?: string,
    action: DeviceAction = "read",
  ) {
    const before = await this.snapshot(organizationId, action);
    const nonce = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("");
    // Native proof and JS verification cover this chain/Human/grant and a new
    // nonce. Public IDs, snapshots or a previously signed proof are not login.
    await this.signer.proveDevice({
      chainIdentifier: before.chainIdentifier,
      humanId: before.human.id,
      grantId: before.grant.id,
      nonce,
      expiresAtMs: Date.now() + 60_000,
    });
    const after = await this.snapshot(organizationId, action);
    if (after.versions !== before.versions)
      throw new DeviceIdentityError("state_changed");
    return Object.freeze({
      humanId: after.human.id,
      grantId: after.grant.id,
      device: after.grant.device,
      generation: after.human.generation,
      grantVersion: after.grant.version,
      organizationScope: after.grant.org_scope,
      actions: Object.keys(DEVICE_ACTIONS).filter((action) =>
        after.grant.actions.includes(DEVICE_ACTIONS[action as DeviceAction]),
      ) as DeviceAction[],
      expiresAtMs: after.grant.expires_at_ms,
      chainIdentifier: after.chainIdentifier,
      clockMs: after.clockMs,
      checkedAtMs: Date.now(),
      ...(organizationId
        ? {
            organizationId,
            encryptedKeys: toBase64(
              Uint8Array.from(after.grant.encrypted_keys),
            ),
            authorityPin: after.versions,
          }
        : {}),
    });
  }
}
