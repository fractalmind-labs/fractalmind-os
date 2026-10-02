import { bcs } from "@mysten/sui/bcs";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { fromBase64, toBase64, normalizeSuiAddress } from "@mysten/sui/utils";
import {
  FractalMindSDK,
  SelfPayTransactionManager,
  TransactionPreflightError,
  IdentityRegistryBcs,
  RecoveryLocationBcs,
  RecoveryRecordBcs,
  HumanIdentityBcs,
  type TransactionJournal,
  type SelfPayFeeQuote,
  type SelfPayTransactionOutcome,
} from "@fractalmind-labs/fractalmind-sdk";
import { normalizeProfile, ChainReadSession } from "./chain";
import { NativeDeviceSigner } from "./native-device";
import { NativeRecoverySigner } from "./native-onboarding";
import { DeviceIdentityVerifier } from "./device-identity";
import type { ConnectionProfile } from "./domain";

export type DeploymentProfile = Omit<ConnectionProfile, "humanId">;
/** Match the typed validator abort, never a message substring or another
 * package's coincidentally identical error number. No automatic rename/retry. */
export function identityCreationFailure(
  error: unknown,
  packageId: string,
): string {
  if (!(error instanceof TransactionPreflightError))
    return "native_or_chain_unavailable";
  const cause = error.cause as
    | {
        $kind?: string;
        MoveAbort?: {
          abortCode?: string;
          location?: {
            package?: string;
            module?: string;
            functionName?: string;
          };
        };
      }
    | undefined;
  if (
    error.code === "simulation_failed" &&
    cause?.$kind === "MoveAbort" &&
    cause.MoveAbort?.abortCode === "3002" &&
    cause.MoveAbort.location?.package === packageId &&
    cause.MoveAbort.location.module === "organization" &&
    cause.MoveAbort.location.functionName === "new_organization"
  )
    return "organization_name_taken";
  return error.code;
}
export function normalizeDeployment(
  value: DeploymentProfile,
): DeploymentProfile {
  const { humanId: _, ...deployment } = normalizeProfile({
    ...value,
    humanId: normalizeSuiAddress("0x1"),
  });
  return deployment;
}

/** An actual two-transaction onboarding session. The durable journal contains
 * only stable request IDs, digests and Gas metadata. Reads never authorize a
 * write; every write needs its separate, live quote and explicit submit. */
export class IdentityCreation {
  readonly sdk: FractalMindSDK;
  readonly client: SuiGrpcClient;
  readonly recoveryManager: SelfPayTransactionManager;
  readonly deviceManager: SelfPayTransactionManager;
  readonly identityRequest: string;
  constructor(
    readonly deployment: DeploymentProfile,
    readonly recovery: NativeRecoverySigner,
    readonly device: NativeDeviceSigner,
    journal: TransactionJournal,
  ) {
    if (
      recovery.material.network !== deployment.network ||
      recovery.material.device.address !== device.device.address ||
      recovery.material.device.encryptionPublicKey !==
        device.device.encryptionPublicKey
    )
      throw new Error("Native device differs from creation material");
    this.client = new SuiGrpcClient({
      baseUrl: deployment.rpcUrl,
      network: deployment.network,
    });
    this.sdk = new FractalMindSDK({ ...deployment, client: this.client });
    this.recoveryManager = new SelfPayTransactionManager({
      client: this.client,
      network: deployment.network,
      signer: recovery,
      journal,
    });
    this.deviceManager = new SelfPayTransactionManager({
      client: this.client,
      network: deployment.network,
      signer: device,
      journal,
    });
    this.identityRequest = `identity:${device.device.profile}`;
  }
  private async pin() {
    const { chainIdentifier } = await this.client.core.getChainIdentifier();
    if (
      this.deployment.chainIdentifier &&
      this.deployment.chainIdentifier !== chainIdentifier
    )
      throw new Error("Creation chain changed");
    return chainIdentifier;
  }
  private async shared(id: string, type: string) {
    const { object } = await this.client.core.getObject({
      objectId: id,
      include: { content: true },
    });
    if (
      object.objectId !== id ||
      object.type !== type ||
      object.owner.$kind !== "Shared" ||
      !object.content
    )
      throw new Error("Unexpected identity source");
    return object;
  }
  private async registry() {
    await this.pin();
    const id = await this.sdk.identity.resolveRegistry(
      this.deployment.registryId,
    );
    const object = await this.shared(
      id,
      `${this.sdk.client.typesPackageId}::identity::IdentityRegistry`,
    );
    const value = IdentityRegistryBcs.parse(object.content!);
    if (
      value.id !== id ||
      value.protocol_registry !== this.deployment.registryId
    )
      throw new Error("Foreign identity registry");
    return value;
  }
  async balances() {
    await this.pin();
    const [recovery, device] = await Promise.all([
      this.client.core.getBalance({
        owner: this.recovery.material.recovery.address,
        coinType: "0x2::sui::SUI",
      }),
      this.client.core.getBalance({
        owner: this.device.device.address,
        coinType: "0x2::sui::SUI",
      }),
    ]);
    return {
      recovery: recovery.balance.balance,
      device: device.balance.balance,
    };
  }
  /** Locate the stable Human from the public recovery address, without importing
   * a secret code into JS. This establishes records, not device authorization. */
  async locate() {
    const registry = await this.registry();
    let location;
    try {
      const result = await this.client.core.getDynamicField({
        parentId: registry.recoveries.id,
        name: {
          type: "address",
          bcs: bcs.Address.serialize(
            this.recovery.material.recovery.address,
          ).toBytes(),
        },
      });
      location = RecoveryLocationBcs.parse(result.dynamicField.value.bcs);
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "reason" in error &&
        error.reason === "notFound"
      )
        return null;
      throw error;
    }
    const prefix = `${this.sdk.client.typesPackageId}::identity::`;
    const [humanObject, recordObject] = await Promise.all([
      this.shared(location.human_id, prefix + "HumanIdentity"),
      this.shared(location.record_id, prefix + "RecoveryRecord"),
    ]);
    const human = HumanIdentityBcs.parse(humanObject.content!),
      record = RecoveryRecordBcs.parse(recordObject.content!);
    if (
      human.id !== location.human_id ||
      record.id !== location.record_id ||
      record.human_id !== human.id ||
      record.registry_id !== registry.id ||
      human.registry_id !== registry.id ||
      human.network !== this.deployment.network ||
      record.network !== this.deployment.network ||
      !record.active ||
      record.version !== location.version ||
      human.recovery_version !== record.version ||
      human.recovery_record !== record.id ||
      record.recovery_address !== this.recovery.material.recovery.address ||
      human.recovery_address !== record.recovery_address ||
      toBase64(Uint8Array.from(record.signing_public_key)) !==
        this.recovery.material.recovery.signingPublicKey ||
      toBase64(Uint8Array.from(record.encryption_public_key)) !==
        this.recovery.material.recovery.encryptionPublicKey
    )
      throw new Error("Recovery location not current");
    await this.pin();
    const profile = {
      ...this.deployment,
      humanId: human.id,
      chainIdentifier: await this.pin(),
    };
    const chain = new ChainReadSession(profile),
      identity = await chain.human();
    const grant = identity.grants.value?.find(
      (g) =>
        g.device === this.device.device.address &&
        !g.org_scope &&
        !g.revoked &&
        g.generation === identity.human.generation,
    );
    if (!grant) throw new Error("No current independent root device");
    await new DeviceIdentityVerifier(chain, this.device, grant.id).verify();
    return {
      profile,
      grantId: grant.id,
      organizations: identity.organizations,
    };
  }
  /** Directory indexes may become visible after the transaction receipt.
   * This bounded reconciliation is read-only and never resends a transaction. */
  async awaitVisible(organization: boolean) {
    const deadline = Date.now() + 5000;
    while (true) {
      const found = await this.locate();
      if (found && (!organization || found.organizations.length > 0))
        return found;
      if (Date.now() >= deadline) return found;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  async prepareIdentity(): Promise<
    SelfPayFeeQuote | SelfPayTransactionOutcome
  > {
    await this.pin();
    const prior = await this.recoveryManager.query(this.identityRequest);
    if (prior) return prior;
    if (await this.locate())
      throw new Error("Identity already exists; continue from chain");
    const material = this.recovery.material,
      registry = await this.registry();
    return this.recoveryManager.prepare({
      requestId: this.identityRequest,
      gasBudget: 200_000_000n,
      transaction: this.sdk.identity.createIdentity({
        identityRegistryId: registry.id,
        network: this.deployment.network,
        device: this.device.device.address,
        deviceEncryptionKey: fromBase64(material.device.encryptionPublicKey),
        encryptedDeviceKeys: fromBase64(material.encryptedDeviceKeys),
        recoverySigningKey: fromBase64(material.recovery.signingPublicKey),
        recoveryEncryptionKey: fromBase64(
          material.recovery.encryptionPublicKey,
        ),
        encryptedBackup: fromBase64(material.encryptedBackup),
      }),
    });
  }
  async submitIdentity(quote: SelfPayFeeQuote) {
    await this.pin();
    if (quote.requestId !== this.identityRequest)
      throw new Error("Wrong creation quote");
    return this.recoveryManager.submit(quote);
  }
  async queryIdentity() {
    await this.pin();
    return this.recoveryManager.query(this.identityRequest);
  }
  async prepareOrganization(
    name: string,
  ): Promise<SelfPayFeeQuote | SelfPayTransactionOutcome> {
    if (!name.trim() || new TextEncoder().encode(name.trim()).length > 128)
      throw new Error("Invalid organization name");
    const found = await this.locate();
    if (!found) throw new Error("Human not confirmed");
    const requestId = this.organizationRequest(found.profile.humanId),
      prior = await this.deviceManager.query(requestId);
    if (prior) return prior;
    if (found.organizations.length)
      throw new Error("Organization already exists; open it");
    return this.deviceManager.prepare({
      requestId,
      gasBudget: 200_000_000n,
      transaction: this.sdk.identity.createOrganization({
        humanId: found.profile.humanId,
        grantId: found.grantId,
        name: name.trim(),
        description: "",
      }),
    });
  }
  organizationRequest(humanId: string) {
    return `org:${this.device.device.profile}:${humanId}`;
  }
  async submitOrganization(quote: SelfPayFeeQuote) {
    await this.pin();
    return this.deviceManager.submit(quote);
  }
  async queryOrganization() {
    const found = await this.locate();
    return found
      ? this.deviceManager.query(
          this.organizationRequest(found.profile.humanId),
        )
      : undefined;
  }
}
