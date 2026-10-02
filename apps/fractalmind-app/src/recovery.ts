import { bcs } from "@mysten/sui/bcs";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { Transaction } from "@mysten/sui/transactions";
import { deriveDynamicFieldID, toBase64, fromBase64 } from "@mysten/sui/utils";
import {
  FractalMindSDK,
  SelfPayTransactionManager,
  IdentityRegistryBcs,
  HumanIdentityBcs,
  RecoveryRecordBcs,
  RecoveryLocationBcs,
  type TransactionJournal,
  type SelfPayFeeQuote,
  type SelfPayTransactionOutcome,
} from "@fractalmind-labs/fractalmind-sdk";
import { ChainReadSession, missingIndex } from "./chain";
import { DeviceIdentityVerifier, OrganizationBcs } from "./device-identity";
import { NativeDeviceSigner } from "./native-device";
import {
  NativeImportedRecoverySigner,
  recoveryFingerprint,
  type RecoverySource,
  type RecoveryStage,
} from "./native-recovery";
import { normalizeDeployment, type DeploymentProfile } from "./onboarding";
import type { ConnectionProfile } from "./domain";

export class IdentityRecoveryError extends Error {
  constructor(
    readonly code:
      | "invalid_source"
      | "code_not_found"
      | "code_consumed"
      | "source_changed"
      | "invalid_stage"
      | "invalid_quote"
      | "backup_not_confirmed"
      | "original_transaction_exists"
      | "device_not_ready",
  ) {
    super(code);
  }
}
export type RecoveryOrganization = {
  objectId: string;
  name: string;
  owned: boolean;
  active: boolean;
  keyVersion: string;
};
export type RecoveryInspection = {
  phase: "ready" | "recovered";
  humanId: string;
  generation: string;
  recoveryVersion: string;
  organizations: RecoveryOrganization[];
  profile: ConnectionProfile;
  grantId?: string;
};
const id = /^0x[0-9a-f]{64}$/;
function reject(): never {
  throw new IdentityRecoveryError("invalid_source");
}
/** Stable request IDs/digests are technical state. Human, orgs, backup/version
 * and grants are always reconstructed from raw current chain sources. */
export class IdentityRecovery {
  readonly deployment: DeploymentProfile;
  readonly client: SuiGrpcClient;
  readonly sdk: FractalMindSDK;
  readonly manager: SelfPayTransactionManager;
  readonly requestId: string;
  private pinned?: string;
  private quotes = new WeakMap<
    SelfPayFeeQuote,
    { pin: string; fingerprint: string }
  >();
  constructor(
    deployment: DeploymentProfile,
    readonly recovery: NativeImportedRecoverySigner,
    readonly device: NativeDeviceSigner,
    journal: TransactionJournal,
  ) {
    this.deployment = Object.freeze(normalizeDeployment(deployment));
    if (
      recovery.material.network !== deployment.network ||
      JSON.stringify(recovery.material.device) !== JSON.stringify(device.device)
    )
      reject();
    this.pinned = this.deployment.chainIdentifier;
    this.client = new SuiGrpcClient({
      baseUrl: this.deployment.rpcUrl,
      network: this.deployment.network,
    });
    this.sdk = new FractalMindSDK({ ...this.deployment, client: this.client });
    this.requestId = `recover:${device.device.profile}`;
    this.manager = new SelfPayTransactionManager({
      client: this.client,
      network: this.deployment.network,
      signer: recovery,
      journal,
    });
  }
  private async pin() {
    const { chainIdentifier } = await this.client.core.getChainIdentifier();
    if (
      !/^[A-Za-z0-9]{1,64}$/.test(chainIdentifier) ||
      (this.pinned && this.pinned !== chainIdentifier)
    )
      reject();
    this.pinned = chainIdentifier;
    return chainIdentifier;
  }
  private async shared(objectId: string, type: string) {
    if (!id.test(objectId)) reject();
    const { object } = await this.client.core.getObject({
      objectId,
      include: { content: true },
    });
    if (
      object.objectId !== objectId ||
      object.type !== type ||
      object.owner.$kind !== "Shared" ||
      !object.content
    )
      reject();
    return object;
  }
  private async identity() {
    const chainIdentifier = await this.pin(),
      prefix = `${this.sdk.client.typesPackageId}::identity::`;
    const registryId = await this.sdk.identity.resolveRegistry(
      this.deployment.registryId,
    );
    const registryObject = await this.shared(
      registryId,
      prefix + "IdentityRegistry",
    );
    const registry = IdentityRegistryBcs.parse(registryObject.content!);
    if (
      registry.id !== registryId ||
      registry.protocol_registry !== this.deployment.registryId
    )
      reject();
    const name = {
      type: "address",
      bcs: bcs.Address.serialize(
        this.recovery.material.recovery.address,
      ).toBytes(),
    };
    const locationResponse = await this.client.core
      .getDynamicField({ parentId: registry.recoveries.id, name })
      .catch((error) => {
        const expected = deriveDynamicFieldID(
          registry.recoveries.id,
          { address: null },
          name.bcs,
        );
        if (
          error &&
          typeof error === "object" &&
          "reason" in error &&
          error.reason === "notFound" &&
          "objectId" in error &&
          error.objectId === expected
        )
          throw new IdentityRecoveryError("code_not_found");
        throw error;
      });
    if (
      locationResponse.dynamicField.value.type !==
      prefix + "RecoveryLocation"
    )
      reject();
    const location = RecoveryLocationBcs.parse(
      locationResponse.dynamicField.value.bcs,
    );
    const [humanObject, recordObject] = await Promise.all([
      this.shared(location.human_id, prefix + "HumanIdentity"),
      this.shared(location.record_id, prefix + "RecoveryRecord"),
    ]);
    const human = HumanIdentityBcs.parse(humanObject.content!),
      record = RecoveryRecordBcs.parse(recordObject.content!);
    if (
      human.id !== location.human_id ||
      record.id !== location.record_id ||
      human.registry_id !== registryId ||
      record.registry_id !== registryId ||
      human.network !== this.deployment.network ||
      record.network !== this.deployment.network ||
      record.human_id !== human.id ||
      record.format_version !== 1 ||
      record.version !== location.version ||
      record.recovery_address !== this.recovery.material.recovery.address ||
      toBase64(Uint8Array.from(record.signing_public_key)) !==
        this.recovery.material.recovery.signingPublicKey ||
      toBase64(Uint8Array.from(record.encryption_public_key)) !==
        this.recovery.material.recovery.encryptionPublicKey ||
      new Set(human.organizations).size !== human.organizations.length ||
      human.organizations.length > 256
    )
      reject();
    await this.pin();
    return {
      chainIdentifier,
      registry,
      human,
      record,
      humanObject,
      registryObject,
      recordObject,
    };
  }
  private async organizations(humanId: string, ids: string[]) {
    const rows: RecoveryOrganization[] = [],
      pins: string[] = [];
    for (const objectId of [...ids].sort()) {
      const object = await this.shared(
        objectId,
        `${this.sdk.client.typesPackageId}::organization::Organization`,
      );
      const org = OrganizationBcs.parse(object.content!);
      if (org.id !== objectId) reject();
      const index = await this.sdk.productRecord
        .listCurrent(objectId, null, 1)
        .catch((error) => {
          if (
            missingIndex(
              error,
              objectId,
              `${this.sdk.client.typesPackageId}::product_record::IndexBinding`,
            )
          )
            return { keyVersion: "1" };
          throw error;
        });
      if (
        !/^[1-9][0-9]{0,19}$/.test(index.keyVersion) ||
        BigInt(index.keyVersion) > 2n ** 64n - 1n
      )
        reject();
      rows.push({
        objectId,
        name: org.name,
        owned: org.admin === humanId,
        active: org.is_active,
        keyVersion: index.keyVersion,
      });
      pins.push(`${objectId}:${object.version}:${index.keyVersion}`);
    }
    return { rows, pins };
  }
  private async snapshot() {
    const current = await this.identity(),
      { human, record } = current;
    if (!record.active) throw new IdentityRecoveryError("code_consumed");
    if (
      human.recovery_record !== record.id ||
      human.recovery_address !== record.recovery_address ||
      human.recovery_version !== record.version
    )
      reject();
    const organizations = await this.organizations(
      human.id,
      human.organizations,
    );
    const source: RecoverySource = {
      chainIdentifier: current.chainIdentifier,
      registryId: current.registry.id,
      humanId: human.id,
      recoveryRecordId: record.id,
      recoveryVersion: record.version,
      backupVersion: record.backup_version,
      generation: human.generation,
      encryptedBackup: toBase64(Uint8Array.from(record.encrypted_backup)),
      organizations: organizations.rows.map((o) => ({
        organizationId: o.objectId,
        keyVersion: o.keyVersion,
        rotate: o.owned && o.active,
      })),
    };
    const fingerprint = await recoveryFingerprint(source);
    const pin = JSON.stringify([
      fingerprint,
      current.registryObject.version,
      current.humanObject.version,
      current.recordObject.version,
      organizations.pins,
    ]);
    await this.pin();
    return {
      source,
      fingerprint,
      pin,
      current,
      organizations: organizations.rows,
    };
  }
  private checkStage(
    stage: RecoveryStage,
    snapshot: Awaited<ReturnType<IdentityRecovery["snapshot"]>>,
  ) {
    const expected = snapshot.source.organizations
      .filter((o) => o.rotate)
      .map((o) => ({
        organizationId: o.organizationId,
        oldVersion: o.keyVersion,
        newVersion: (BigInt(o.keyVersion) + 1n).toString(),
      }));
    if (
      stage.sourceFingerprint !== snapshot.fingerprint ||
      JSON.stringify(stage.rotations) !== JSON.stringify(expected)
    )
      throw new IdentityRecoveryError("source_changed");
  }
  async inspect(): Promise<RecoveryInspection> {
    const current = await this.identity(),
      { human, record } = current;
    const profile = {
      ...this.deployment,
      chainIdentifier: current.chainIdentifier,
      humanId: human.id,
    };
    if (record.active) {
      const value = await this.snapshot();
      return {
        phase: "ready",
        humanId: human.id,
        generation: human.generation,
        recoveryVersion: human.recovery_version,
        organizations: value.organizations,
        profile,
      };
    }
    const stage = await this.recovery.loadStage();
    if (
      !stage ||
      human.recovery_address !== stage.nextRecovery.address ||
      BigInt(human.recovery_version) !== BigInt(record.version) + 1n
    )
      throw new IdentityRecoveryError("code_consumed");
    const prefix = `${this.sdk.client.typesPackageId}::identity::`;
    const nextObject = await this.shared(
      human.recovery_record,
      prefix + "RecoveryRecord",
    );
    const next = RecoveryRecordBcs.parse(nextObject.content!);
    if (
      next.id !== human.recovery_record ||
      !next.active ||
      next.registry_id !== current.registry.id ||
      next.human_id !== human.id ||
      next.network !== this.deployment.network ||
      next.format_version !== 1 ||
      next.version !== human.recovery_version ||
      next.recovery_address !== stage.nextRecovery.address ||
      toBase64(Uint8Array.from(next.signing_public_key)) !==
        stage.nextRecovery.signingPublicKey ||
      toBase64(Uint8Array.from(next.encryption_public_key)) !==
        stage.nextRecovery.encryptionPublicKey
    )
      reject();
    const chain = new ChainReadSession(profile),
      identity = await chain.human();
    if (!identity.grants.value)
      throw new IdentityRecoveryError("device_not_ready");
    const matches = identity.grants.value.filter(
      (g) =>
        g.device === this.device.device.address &&
        !g.org_scope &&
        !g.revoked &&
        g.generation === human.generation,
    );
    if (matches.length !== 1)
      throw new IdentityRecoveryError("device_not_ready");
    const grantId = matches[0].id;
    await new DeviceIdentityVerifier(chain, this.device, grantId).verify();
    const after = await this.identity();
    if (
      after.humanObject.version !== current.humanObject.version ||
      after.record.active ||
      after.human.recovery_record !== next.id ||
      after.registryObject.version !== current.registryObject.version
    )
      throw new IdentityRecoveryError("source_changed");
    await this.pin();
    return {
      phase: "recovered",
      humanId: human.id,
      generation: human.generation,
      recoveryVersion: human.recovery_version,
      organizations: (await this.organizations(human.id, human.organizations))
        .rows,
      profile,
      grantId,
    };
  }
  async query() {
    await this.pin();
    return this.manager.query(this.requestId);
  }
  async balances() {
    await this.pin();
    const [old, device] = await Promise.all([
      this.client.core.getBalance({
        owner: this.recovery.material.recovery.address,
        coinType: "0x2::sui::SUI",
      }),
      this.client.core.getBalance({
        owner: this.device.device.address,
        coinType: "0x2::sui::SUI",
      }),
    ]);
    await this.pin();
    return { recovery: old.balance.balance, device: device.balance.balance };
  }
  async prepareReplacement() {
    if (await this.query())
      throw new IdentityRecoveryError("original_transaction_exists");
    const snapshot = await this.snapshot(),
      existing = await this.recovery.loadStage();
    if (existing) {
      this.checkStage(existing, snapshot);
      return { stage: existing, recoveryCode: "" };
    }
    const result = await this.recovery.prepareStage(snapshot.source);
    this.checkStage(result.stage, snapshot);
    // Return the one-shot credential before any further RPC that could fail.
    // This step never quotes or broadcasts; prepare/submit re-read all sources.
    return result;
  }
  async prepare(
    backupConfirmed: boolean,
  ): Promise<SelfPayFeeQuote | SelfPayTransactionOutcome> {
    if (backupConfirmed !== true)
      throw new IdentityRecoveryError("backup_not_confirmed");
    const prior = await this.query();
    if (prior) return prior;
    const before = await this.snapshot(),
      stage = await this.recovery.loadStage();
    if (!stage) throw new IdentityRecoveryError("invalid_stage");
    this.checkStage(stage, before);
    const tx = new Transaction();
    this.sdk.identity.assertRecoverySnapshot({
      tx,
      humanId: before.source.humanId,
      recordId: before.source.recoveryRecordId,
      expectedGeneration: before.source.generation,
      expectedBackupVersion: before.source.backupVersion,
      expectedOrganizations: [...before.current.human.organizations],
    });
    for (const rotation of stage.rotations)
      this.sdk.productRecord.rotateKeyForRecovery({
        tx,
        organizationId: rotation.organizationId,
        humanId: before.source.humanId,
        recordId: before.source.recoveryRecordId,
        expectedKeyVersion: rotation.oldVersion,
      });
    this.sdk.identity.recoverIdentity({
      tx,
      identityRegistryId: before.source.registryId,
      humanId: before.source.humanId,
      recordId: before.source.recoveryRecordId,
      recoverySigningKey: fromBase64(stage.nextRecovery.signingPublicKey),
      recoveryEncryptionKey: fromBase64(stage.nextRecovery.encryptionPublicKey),
      encryptedBackup: fromBase64(stage.encryptedBackup),
      device: this.device.device.address,
      deviceEncryptionKey: fromBase64(this.device.device.encryptionPublicKey),
      encryptedDeviceKeys: fromBase64(stage.encryptedDeviceKeys),
    });
    const quote = await this.manager.prepare({
      requestId: this.requestId,
      transaction: tx,
      gasBudget: 200_000_000n,
    });
    const after = await this.snapshot();
    if (after.pin !== before.pin)
      throw new IdentityRecoveryError("source_changed");
    this.quotes.set(quote, {
      pin: after.pin,
      fingerprint: stage.sourceFingerprint,
    });
    return quote;
  }
  async submit(quote: SelfPayFeeQuote, backupConfirmed: boolean) {
    if (backupConfirmed !== true)
      throw new IdentityRecoveryError("backup_not_confirmed");
    const plan = this.quotes.get(quote);
    if (!plan || quote.requestId !== this.requestId)
      throw new IdentityRecoveryError("invalid_quote");
    const prior = await this.query();
    if (prior) return prior;
    const current = await this.snapshot(),
      stage = await this.recovery.loadStage();
    if (
      !stage ||
      plan.pin !== current.pin ||
      stage.sourceFingerprint !== plan.fingerprint
    )
      throw new IdentityRecoveryError("source_changed");
    this.checkStage(stage, current);
    return this.manager.submit(quote);
  }
  async awaitRecovered() {
    const deadline = Date.now() + 5000;
    while (true) {
      try {
        const state = await this.inspect();
        if (state.phase === "recovered") return state;
      } catch (error) {
        if (
          !(error instanceof IdentityRecoveryError) ||
          !["device_not_ready", "source_changed"].includes(error.code)
        )
          throw error;
        if (Date.now() >= deadline) throw error;
      }
      if (Date.now() >= deadline)
        throw new IdentityRecoveryError("device_not_ready");
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}
