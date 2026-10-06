import { bcs } from "@mysten/sui/bcs";
import { Ed25519PublicKey } from "@mysten/sui/keypairs/ed25519";
import { fromBase64, toBase64 } from "@mysten/sui/utils";
import { Transaction } from "@mysten/sui/transactions";
import {
  DevicePairingRequestBcs,
  HumanIdentityBcs,
  IdentityRegistryBcs,
  DeviceGrantBcs,
  SelfPayTransactionManager,
  type DeviceAction,
  type TransactionJournal,
  type SelfPayFeeQuote,
  type SelfPayTransactionOutcome,
} from "@fractalmind-labs/fractalmind-sdk";
import { ChainReadSession, missingIndex } from "./chain";
import { DeviceIdentityVerifier, OrganizationBcs } from "./device-identity";
import { NativeDeviceSigner, call, type NativeInvoke } from "./native-device";
import { wrappedEnvelope } from "./native-onboarding";

export class PairingError extends Error {
  constructor(
    readonly code:
      | "invalid_source"
      | "not_pending"
      | "expired"
      | "state_changed"
      | "wrong_device"
      | "confirmation_required"
      | "invalid_quote"
      | "invalid_input"
      | "sync_pending"
      | "data_pending",
  ) {
    super(code);
  }
}
export type PairingRequest = ReturnType<typeof DevicePairingRequestBcs.parse>;
export type PairingPlatform =
  | "macos"
  | "windows"
  | "ubuntu"
  | "ios"
  | "android";
const id = /^0x[0-9a-f]{64}$/;
const gasBudget = 200_000_000n;
type Operation = "create" | "approve" | "reject" | "cancel" | "share";
type Plan = {
  operation: Operation;
  pin: string;
  requestId?: string;
  grantId?: string;
  technicalId: string;
};
/** Both ends compare this public fingerprint. It binds chain, request, identity,
 * organization, generation, device and both keys; it grants no authority. */
export async function pairingFingerprint(
  chainIdentifier: string,
  request: PairingRequest,
) {
  const bytes = new TextEncoder().encode(
    JSON.stringify([
      "fractalmind.pairing.v1",
      chainIdentifier,
      request.id,
      request.human_id,
      request.organization_id,
      request.generation,
      request.device,
      toBase64(Uint8Array.from(request.signing_public_key)),
      toBase64(Uint8Array.from(request.encryption_public_key)),
      request.expires_at_ms,
      request.device_name,
      request.platform,
    ]),
  );
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (n) => n.toString(16).padStart(2, "0"),
  ).join("");
}
/** All pairing state is read from Sui. The journal contains only original
 * transaction metadata. No public request or cached profile authorizes a device. */
export class DevicePairing {
  readonly manager: SelfPayTransactionManager;
  private plans = new WeakMap<SelfPayFeeQuote, Plan>();
  constructor(
    readonly chain: ChainReadSession,
    readonly device: NativeDeviceSigner,
    journal: TransactionJournal,
    readonly invoke: NativeInvoke,
  ) {
    this.manager = new SelfPayTransactionManager({
      client: chain.sdk.client.client,
      network: chain.profile.network,
      signer: device,
      journal,
    });
  }
  private get sdk() {
    return this.chain.sdk;
  }
  /** A receipt can precede query visibility. Only read its exact output objects;
   * never replay a transaction or expose the preceding pairing state as current. */
  async awaitVisible(outcome: SelfPayTransactionOutcome, attempts = 40) {
    if (outcome.status !== "confirmed") return false;
    if (
      !outcome.transaction?.effects ||
      !Number.isInteger(attempts) ||
      attempts < 1 ||
      attempts > 40
    )
      throw new PairingError("invalid_source");
    const changes = outcome.transaction.effects.changedObjects.filter(
      (x) => x.outputState === "ObjectWrite" && x.outputVersion,
    );
    if (!changes.length) throw new PairingError("invalid_source");
    await this.chain.checkNetwork();
    for (let attempt = 0; attempt < attempts; attempt++) {
      let visible = true;
      for (const change of changes) {
        try {
          const { object } = await this.sdk.client.client.core.getObject({
            objectId: change.objectId,
          });
          if (object.objectId !== change.objectId)
            throw new PairingError("invalid_source");
          if (BigInt(object.version) < BigInt(change.outputVersion!))
            visible = false;
        } catch (e) {
          if (
            typeof e === "object" &&
            e &&
            "reason" in e &&
            e.reason === "notFound" &&
            "objectId" in e &&
            e.objectId === change.objectId
          )
            visible = false;
          else throw e;
        }
      }
      if (visible) {
        await this.chain.checkNetwork();
        return true;
      }
      if (attempt + 1 < attempts)
        await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return false;
  }
  private async object(objectId: string, module: string, kind: string) {
    if (!id.test(objectId)) throw new PairingError("invalid_source");
    const { object } = await this.sdk.client.client.core.getObject({
      objectId,
      include: { content: true },
    });
    if (
      object.objectId !== objectId ||
      object.owner.$kind !== "Shared" ||
      object.type !== (await this.sdk.client.coreType(module, kind)) ||
      !object.content
    )
      throw new PairingError("invalid_source");
    return object;
  }
  private async base(organizationId: string) {
    const chainIdentifier = await this.chain.checkNetwork();
    const registryId = await this.sdk.identity.resolveRegistry(
      this.chain.profile.registryId,
    );
    const registryObject = await this.object(
      registryId,
      "identity",
      "IdentityRegistry",
    );
    const registry = IdentityRegistryBcs.parse(registryObject.content!);
    const humanObject = await this.object(
      this.chain.profile.humanId,
      "identity",
      "HumanIdentity",
    );
    const human = HumanIdentityBcs.parse(humanObject.content!);
    const orgObject = await this.object(
      organizationId,
      "organization",
      "Organization",
    );
    const org = OrganizationBcs.parse(orgObject.content!);
    if (
      registry.id !== registryId ||
      registry.protocol_registry !== this.chain.profile.registryId ||
      human.id !== this.chain.profile.humanId ||
      human.registry_id !== registryId ||
      human.network !== this.chain.profile.network ||
      org.id !== organizationId ||
      !org.is_active ||
      !human.organizations.includes(org.id)
    )
      throw new PairingError("invalid_source");
    const publicState = await this.chain.human();
    if (publicState.human.generation !== human.generation)
      throw new PairingError("state_changed");
    await this.chain.checkNetwork();
    return {
      chainIdentifier,
      registryId,
      human,
      org,
      clockMs: publicState.clockMs,
      loadedAtMs: publicState.loadedAtMs,
      pin: JSON.stringify([
        chainIdentifier,
        registryObject.version,
        humanObject.version,
        orgObject.version,
      ]),
    };
  }
  async inspect(requestId: string) {
    const object = await this.object(
      requestId,
      "identity",
      "DevicePairingRequest",
    );
    const request = DevicePairingRequestBcs.parse(object.content!);
    if (
      request.id !== requestId ||
      request.human_id !== this.chain.profile.humanId ||
      request.signing_public_key.length !== 32 ||
      request.encryption_public_key.length !== 32 ||
      new Ed25519PublicKey(
        Uint8Array.from(request.signing_public_key),
      ).toSuiAddress() !== request.device ||
      request.status > 3 ||
      (request.status === 1) !== (request.grant_id !== null)
    )
      throw new PairingError("invalid_source");
    const base = await this.base(request.organization_id);
    const expired = BigInt(request.expires_at_ms) <= base.clockMs;
    const superseded = request.generation !== base.human.generation;
    let grant = null;
    let data: "pending" | "wrapped" = "pending";
    if (request.grant_id) {
      const grantObject = await this.object(
        request.grant_id,
        "identity",
        "DeviceGrant",
      );
      grant = DeviceGrantBcs.parse(grantObject.content!);
      if (
        grant.id !== request.grant_id ||
        grant.human_id !== request.human_id ||
        grant.device !== request.device ||
        grant.org_scope !== request.organization_id ||
        toBase64(Uint8Array.from(grant.encryption_public_key)) !==
          toBase64(Uint8Array.from(request.encryption_public_key))
      )
        throw new PairingError("invalid_source");
      if (grant.encrypted_keys.length) data = "wrapped";
    }
    await this.chain.checkNetwork();
    return {
      request,
      base,
      expired,
      superseded,
      grant,
      data,
      fingerprint: await pairingFingerprint(base.chainIdentifier, request),
      pin: JSON.stringify([base.pin, object.version, grant]),
    };
  }
  private pending(state: Awaited<ReturnType<DevicePairing["inspect"]>>) {
    if (state.superseded) throw new PairingError("state_changed");
    if (state.request.status !== 0) throw new PairingError("not_pending");
    if (state.expired) throw new PairingError("expired");
  }
  private technical(operation: Operation, requestId?: string) {
    return `pair-${operation}:${requestId ?? this.device.device.profile}`;
  }
  async query(operation: Operation, requestId?: string) {
    await this.chain.checkNetwork();
    return this.manager.query(this.technical(operation, requestId));
  }
  private async quote(tx: Transaction, plan: Plan) {
    const quote = await this.manager.prepare({
      requestId: plan.technicalId,
      transaction: tx,
      gasBudget,
    });
    this.plans.set(quote, plan);
    return quote;
  }
  async prepareCreate(
    organizationId: string,
    name: string,
    platform: PairingPlatform,
  ) {
    const prior = await this.query("create");
    if (prior) return prior;
    if (
      !name.trim() ||
      new TextEncoder().encode(name.trim()).length > 128 ||
      /[\u0000-\u001f\u007f]/.test(name) ||
      !["macos", "windows", "ubuntu", "ios", "android"].includes(platform)
    )
      throw new PairingError("invalid_input");
    const before = await this.base(organizationId);
    const tx = this.sdk.identity.createDevicePairing({
      humanId: before.human.id,
      organizationId,
      deviceName: name.trim(),
      platform,
      signingPublicKey: fromBase64(this.device.device.signingPublicKey),
      encryptionPublicKey: fromBase64(this.device.device.encryptionPublicKey),
    });
    const quote = await this.quote(tx, {
      operation: "create",
      pin: before.pin,
      technicalId: this.technical("create"),
      requestId: organizationId,
    });
    if ((await this.base(organizationId)).pin !== before.pin)
      throw new PairingError("state_changed");
    return quote;
  }
  async prepareApproval(
    requestId: string,
    grantId: string,
    actions: DeviceAction[] = ["read"],
    days = 7,
    compared = false,
  ) {
    const prior = await this.query("approve", requestId);
    if (prior) return prior;
    if (compared !== true) throw new PairingError("confirmation_required");
    if (!Number.isInteger(days) || days < 1 || days > 365)
      throw new PairingError("invalid_input");
    const before = await this.inspect(requestId);
    this.pending(before);
    const proof = await new DeviceIdentityVerifier(
      this.chain,
      this.device,
      grantId,
    ).verifyOrganization(before.request.organization_id, "approve");
    const tx = this.sdk.identity.approveDevicePairing({
      identityRegistryId: before.base.registryId,
      humanId: before.request.human_id,
      grantId,
      organizationId: before.request.organization_id,
      requestId,
      actions: [...actions],
      expiresAtMs: proof.clockMs + BigInt(days) * 86400000n,
    });
    const pin = JSON.stringify([before.pin, proof.authorityPin]);
    const quote = await this.quote(tx, {
      operation: "approve",
      pin,
      requestId,
      grantId,
      technicalId: this.technical("approve", requestId),
    });
    const after = await this.inspect(requestId);
    const fresh = await new DeviceIdentityVerifier(
      this.chain,
      this.device,
      grantId,
    ).verifyOrganization(before.request.organization_id, "approve");
    if (JSON.stringify([after.pin, fresh.authorityPin]) !== pin)
      throw new PairingError("state_changed");
    return quote;
  }
  async prepareResolution(
    requestId: string,
    operation: "reject" | "cancel",
    grantId?: string,
  ) {
    const prior = await this.query(operation, requestId);
    if (prior) return prior;
    const before = await this.inspect(requestId);
    this.pending(before);
    let authorityPin: string | undefined;
    if (operation === "cancel") {
      if (before.request.device !== this.device.device.address)
        throw new PairingError("wrong_device");
    } else {
      if (!grantId) throw new PairingError("invalid_input");
      authorityPin = (
        await new DeviceIdentityVerifier(
          this.chain,
          this.device,
          grantId,
        ).verifyOrganization(before.request.organization_id, "approve")
      ).authorityPin;
    }
    const tx =
      operation === "cancel"
        ? this.sdk.identity.cancelDevicePairing({ requestId })
        : this.sdk.identity.rejectDevicePairing({
            requestId,
            humanId: before.request.human_id,
            grantId: grantId!,
            organizationId: before.request.organization_id,
          });
    return this.quote(tx, {
      operation,
      pin: JSON.stringify([before.pin, authorityPin]),
      grantId,
      requestId,
      technicalId: this.technical(operation, requestId),
    });
  }
  private async keyVersion(organizationId: string) {
    const index = await this.sdk.productRecord
      .listCurrent(organizationId, null, 1)
      .catch(async (error) => {
        if (
          missingIndex(
            error,
            organizationId,
            await this.sdk.client.coreType("product_record", "IndexBinding"),
          )
        )
          return { keyVersion: "1" };
        throw error;
      });
    return index.keyVersion;
  }
  private async shareSource(requestId: string, grantId: string) {
    const state = await this.inspect(requestId),
      org = state.request.organization_id;
    if (
      state.superseded ||
      state.request.status !== 1 ||
      !state.grant ||
      state.grant.revoked ||
      state.grant.generation !== state.base.human.generation ||
      BigInt(state.grant.expires_at_ms) <= state.base.clockMs
    )
      throw new PairingError("state_changed");
    const verifier = new DeviceIdentityVerifier(
      this.chain,
      this.device,
      grantId,
    );
    const read = await verifier.verifyOrganization(org, "read");
    const approval = await verifier.verifyOrganization(org, "approve");
    if (read.authorityPin !== approval.authorityPin)
      throw new PairingError("state_changed");
    const keyVersion = await this.keyVersion(org);
    return {
      state,
      approval,
      keyVersion,
      pin: JSON.stringify([state.pin, approval.authorityPin, keyVersion]),
    };
  }
  async prepareDataSharing(
    requestId: string,
    grantId: string,
    confirmed = false,
  ) {
    const prior = await this.query("share", requestId);
    if (prior) return prior;
    if (confirmed !== true) throw new PairingError("confirmation_required");
    const before = await this.shareSource(requestId, grantId),
      r = before.state.request;
    const cipher = wrappedEnvelope(
      await call(this.invoke, "fm_device_wrap_organization_keys", {
        profile: this.device.device.profile,
        request: JSON.stringify({
          network: this.chain.profile.network,
          organizationId: r.organization_id,
          keyVersion: before.keyVersion,
          organizationCount: before.state.base.human.organizations.length,
          encryptedKeys: before.approval.encryptedKeys,
          recipientAddress: r.device,
          signingPublicKey: toBase64(Uint8Array.from(r.signing_public_key)),
          encryptionPublicKey: toBase64(
            Uint8Array.from(r.encryption_public_key),
          ),
        }),
      }),
    );
    if (fromBase64(cipher).length > 65536)
      throw new PairingError("invalid_source");
    if ((await this.shareSource(requestId, grantId)).pin !== before.pin)
      throw new PairingError("state_changed");
    const tx = new Transaction();
    this.sdk.productRecord.assertKeyVersion({
      tx,
      organizationId: r.organization_id,
      expectedKeyVersion: before.keyVersion,
    });
    this.sdk.identity.updateDeviceKeys({
      tx,
      humanId: r.human_id,
      grantId,
      targetGrantId: before.state.grant!.id,
      organizationId: r.organization_id,
      expectedVersion: before.state.grant!.version,
      encryptedKeys: fromBase64(cipher),
    });
    const quote = await this.quote(tx, {
      operation: "share",
      pin: before.pin,
      grantId,
      requestId,
      technicalId: this.technical("share", requestId),
    });
    if ((await this.shareSource(requestId, grantId)).pin !== before.pin)
      throw new PairingError("state_changed");
    return quote;
  }
  async submit(quote: SelfPayFeeQuote) {
    await this.chain.checkNetwork();
    const plan = this.plans.get(quote);
    if (!plan || plan.technicalId !== quote.requestId)
      throw new PairingError("invalid_quote");
    const prior = await this.manager.query(plan.technicalId);
    if (prior) return prior;
    let pin: string;
    if (plan.operation === "create")
      pin = (await this.base(plan.requestId!)).pin;
    else if (plan.operation === "share")
      pin = (await this.shareSource(plan.requestId!, plan.grantId!)).pin;
    else {
      const state = await this.inspect(plan.requestId!);
      this.pending(state);
      const proof = plan.grantId
        ? await new DeviceIdentityVerifier(
            this.chain,
            this.device,
            plan.grantId,
          ).verifyOrganization(state.request.organization_id, "approve")
        : undefined;
      pin = JSON.stringify([state.pin, proof?.authorityPin]);
    }
    if (pin !== plan.pin) throw new PairingError("state_changed");
    return this.manager.submit(quote);
  }
  async requestFromResult(outcome: SelfPayTransactionOutcome) {
    if (outcome.status !== "confirmed") throw new PairingError("state_changed");
    const requestType = await this.sdk.client.coreType(
      "identity",
      "DevicePairingRequest",
    );
    const found = Object.entries(outcome.transaction?.objectTypes ?? {}).filter(
      ([, type]) => type === requestType,
    );
    if (found.length !== 1) throw new PairingError("invalid_source");
    return found[0][0];
  }
  async verifyRequester(requestId: string) {
    const state = await this.inspect(requestId);
    if (
      state.request.device !== this.device.device.address ||
      toBase64(Uint8Array.from(state.request.encryption_public_key)) !==
        this.device.device.encryptionPublicKey
    )
      throw new PairingError("wrong_device");
    if (state.request.status !== 1 || !state.grant)
      throw new PairingError("not_pending");
    await new DeviceIdentityVerifier(
      this.chain,
      this.device,
      state.grant.id,
    ).verifyOrganization(state.request.organization_id, "read");
    // Wrapped bytes alone do not prove decryptability. The private-record reader
    // verifies and authenticates an actual body before declaring data unlocked.
    return {
      profile: this.chain.profile,
      grantId: state.grant.id,
      data: state.data,
    };
  }
}
