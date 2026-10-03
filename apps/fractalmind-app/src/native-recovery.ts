import { fromBase64, toBase64 } from "@mysten/sui/utils";
import { Ed25519PublicKey } from "@mysten/sui/keypairs/ed25519";
import { verifyTransactionSignature } from "@mysten/sui/verify";
import {
  parseRecoveryCode,
  type NetworkName,
} from "@fractalmind-labs/fractalmind-sdk";
import {
  call,
  publicResult,
  profileCheck,
  NativeDeviceError,
  type NativeInvoke,
  type DevicePublic,
} from "./native-device";
import { wrappedEnvelope } from "./native-onboarding";

export type RecoveryImported = Readonly<{
  format: 1;
  network: NetworkName;
  device: DevicePublic;
  recovery: DevicePublic;
}>;
export type RecoveryRotation = Readonly<{
  organizationId: string;
  oldVersion: string;
  newVersion: string;
}>;
export type RecoveryStage = Readonly<{
  imported: RecoveryImported;
  nextRecovery: DevicePublic;
  encryptedBackup: string;
  encryptedDeviceKeys: string;
  sourceFingerprint: string;
  rotations: readonly RecoveryRotation[];
}>;
export type RecoverySource = {
  chainIdentifier: string;
  registryId: string;
  humanId: string;
  recoveryRecordId: string;
  recoveryVersion: string;
  backupVersion: string;
  generation: string;
  encryptedBackup: string;
  organizations: Array<{
    organizationId: string;
    keyVersion: string;
    rotate: boolean;
  }>;
};
const id = /^0x[0-9a-f]{64}$/;
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new NativeDeviceError("invalid_response");
  return value as Record<string, unknown>;
}
function imported(
  value: unknown,
  profile: string,
  network: NetworkName,
): RecoveryImported {
  const data = object(value);
  if (data.format !== 1 || data.network !== network)
    throw new NativeDeviceError("invalid_response");
  const device = publicResult(data.device, profile),
    recovery = publicResult(data.recovery, profile);
  if (
    device.address === recovery.address ||
    device.encryptionPublicKey === recovery.encryptionPublicKey
  )
    throw new NativeDeviceError("invalid_response");
  return Object.freeze({ format: 1, network, device, recovery });
}
function positive(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[1-9][0-9]{0,19}$/.test(value) ||
    BigInt(value) > 2n ** 64n - 1n
  )
    throw new NativeDeviceError("invalid_response");
  return value;
}
function stage(value: unknown, expected: RecoveryImported): RecoveryStage {
  const data = object(value),
    origin = imported(data.imported, expected.device.profile, expected.network);
  if (JSON.stringify(origin) !== JSON.stringify(expected))
    throw new NativeDeviceError("invalid_response");
  const nextRecovery = publicResult(data.nextRecovery, expected.device.profile);
  if (
    [expected.device.address, expected.recovery.address].includes(
      nextRecovery.address,
    ) ||
    [
      expected.device.encryptionPublicKey,
      expected.recovery.encryptionPublicKey,
    ].includes(nextRecovery.encryptionPublicKey) ||
    typeof data.sourceFingerprint !== "string" ||
    !/^[0-9a-f]{64}$/.test(data.sourceFingerprint) ||
    !Array.isArray(data.rotations) ||
    data.rotations.length > 256
  )
    throw new NativeDeviceError("invalid_response");
  const seen = new Set<string>();
  const rotations = data.rotations.map((value) => {
    const row = object(value);
    if (
      typeof row.organizationId !== "string" ||
      !id.test(row.organizationId) ||
      seen.has(row.organizationId)
    )
      throw new NativeDeviceError("invalid_response");
    seen.add(row.organizationId);
    const oldVersion = positive(row.oldVersion),
      newVersion = positive(row.newVersion);
    if (BigInt(oldVersion) + 1n !== BigInt(newVersion))
      throw new NativeDeviceError("invalid_response");
    return Object.freeze({
      organizationId: row.organizationId,
      oldVersion,
      newVersion,
    });
  });
  const encryptedBackup = wrappedEnvelope(data.encryptedBackup),
    encryptedDeviceKeys = wrappedEnvelope(data.encryptedDeviceKeys);
  if (
    fromBase64(encryptedBackup).length > 65536 ||
    fromBase64(encryptedDeviceKeys).length > 65536
  )
    throw new NativeDeviceError("invalid_response");
  return Object.freeze({
    imported: origin,
    nextRecovery,
    encryptedBackup,
    encryptedDeviceKeys,
    sourceFingerprint: data.sourceFingerprint,
    rotations: Object.freeze(rotations),
  });
}
/** Same ASCII field order as the native Source serializer. No secret material is
 * hashed here: the code/private keys/keyring remain behind the native transport. */
export function canonicalRecoverySource(source: RecoverySource) {
  return JSON.stringify({
    chainIdentifier: source.chainIdentifier,
    registryId: source.registryId,
    humanId: source.humanId,
    recoveryRecordId: source.recoveryRecordId,
    recoveryVersion: source.recoveryVersion,
    backupVersion: source.backupVersion,
    generation: source.generation,
    encryptedBackup: source.encryptedBackup,
    organizations: source.organizations.map((o) => ({
      organizationId: o.organizationId,
      keyVersion: o.keyVersion,
      rotate: o.rotate,
    })),
  });
}
export async function recoveryFingerprint(source: RecoverySource) {
  const bytes = new TextEncoder().encode(canonicalRecoverySource(source));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
/** Explicit import only. There is no JS derivation of recovery signing/encryption
 * private keys, and loading never returns either backup credential. */
export class NativeImportedRecoverySigner {
  private constructor(
    private invoke: NativeInvoke,
    readonly material: RecoveryImported,
  ) {}
  static async import(
    invoke: NativeInvoke,
    profile: string,
    network: NetworkName,
    code: string,
  ) {
    profileCheck(profile);
    if (
      typeof code !== "string" ||
      code.length > 100 ||
      !code.startsWith(`FM1:${network}:`)
    )
      throw new NativeDeviceError("invalid_recovery");
    return new NativeImportedRecoverySigner(
      invoke,
      imported(
        await call(invoke, "fm_recovery_import", { profile, network, code }),
        profile,
        network,
      ),
    );
  }
  static async load(
    invoke: NativeInvoke,
    profile: string,
    network: NetworkName,
  ) {
    profileCheck(profile);
    return new NativeImportedRecoverySigner(
      invoke,
      imported(
        await call(invoke, "fm_recovery_imported_public", { profile, network }),
        profile,
        network,
      ),
    );
  }
  async loadStage(): Promise<RecoveryStage | null> {
    try {
      return stage(
        await call(this.invoke, "fm_recovery_prepared_public", {
          profile: this.material.device.profile,
          network: this.material.network,
        }),
        this.material,
      );
    } catch (error) {
      if (
        error instanceof NativeDeviceError &&
        error.code === "not_initialized"
      )
        return null;
      throw error;
    }
  }
  async prepareStage(source: RecoverySource) {
    const data = object(
      await call(this.invoke, "fm_recovery_prepare", {
        profile: this.material.device.profile,
        network: this.material.network,
        source: canonicalRecoverySource(source),
      }),
    );
    if (typeof data.recoveryCode !== "string" || data.recoveryCode.length > 100)
      throw new NativeDeviceError("invalid_response");
    try {
      const parsed = parseRecoveryCode(data.recoveryCode);
      parsed.entropy.fill(0);
      if (parsed.network !== this.material.network) throw new Error();
    } catch {
      throw new NativeDeviceError("invalid_response");
    }
    return {
      stage: stage(data.public, this.material),
      recoveryCode: data.recoveryCode,
    };
  }
  getPublicKey() {
    return new Ed25519PublicKey(
      fromBase64(this.material.recovery.signingPublicKey),
    );
  }
  async signTransaction(bytes: Uint8Array) {
    if (
      !(bytes instanceof Uint8Array) ||
      bytes.length < 1 ||
      bytes.length > 1048576
    )
      throw new NativeDeviceError("invalid_transaction");
    const input = new Uint8Array(bytes),
      encoded = toBase64(input);
    const data = object(
      await call(this.invoke, "fm_recovery_sign_transaction", {
        profile: this.material.device.profile,
        network: this.material.network,
        phase: "old",
        bytes: encoded,
      }),
    );
    if (data.bytes !== encoded || typeof data.signature !== "string")
      throw new NativeDeviceError("invalid_response");
    try {
      const raw = fromBase64(data.signature);
      if (
        raw.length !== 97 ||
        raw[0] !== 0 ||
        toBase64(raw) !== data.signature ||
        toBase64(raw.slice(65)) !== this.material.recovery.signingPublicKey
      )
        throw new Error();
      await verifyTransactionSignature(input, data.signature, {
        address: this.material.recovery.address,
      });
    } catch {
      throw new NativeDeviceError("invalid_response");
    }
    return { bytes: encoded, signature: data.signature };
  }
}
