import { fromBase64, toBase64 } from "@mysten/sui/utils";
import { verifyTransactionSignature } from "@mysten/sui/verify";
import { Ed25519PublicKey } from "@mysten/sui/keypairs/ed25519";
import {
  parseRecoveryCode,
  type NetworkName,
} from "@fractalmind-labs/fractalmind-sdk";
import {
  call,
  publicResult,
  profileCheck,
  NativeDeviceError,
  type DevicePublic,
  type NativeInvoke,
} from "./native-device";

export type OnboardingPublic = Readonly<{
  format: 1;
  network: NetworkName;
  device: DevicePublic;
  recovery: DevicePublic;
  encryptedBackup: string;
  encryptedDeviceKeys: string;
}>;
export function wrappedEnvelope(value: unknown) {
  if (typeof value !== "string" || value.length > 87520)
    throw new NativeDeviceError("invalid_response");
  try {
    const bytes = fromBase64(value);
    if (
      bytes.length < 100 ||
      bytes.length > 65636 ||
      toBase64(bytes) !== value ||
      new TextDecoder().decode(bytes.slice(0, 4)) !== "FMW1" ||
      new TextDecoder().decode(bytes.slice(68, 72)) !== "FME1"
    )
      throw new Error();
  } catch {
    throw new NativeDeviceError("invalid_response");
  }
  return value;
}
function bundle(
  value: unknown,
  profile: string,
  network: NetworkName,
): OnboardingPublic {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new NativeDeviceError("invalid_response");
  const data = value as Record<string, unknown>;
  if (data.format !== 1 || data.network !== network)
    throw new NativeDeviceError("invalid_response");
  const device = publicResult(data.device, profile),
    recovery = publicResult(data.recovery, profile);
  if (
    device.address === recovery.address ||
    device.encryptionPublicKey === recovery.encryptionPublicKey
  )
    throw new NativeDeviceError("invalid_response");
  return Object.freeze({
    format: 1,
    network,
    device,
    recovery,
    encryptedBackup: wrappedEnvelope(data.encryptedBackup),
    encryptedDeviceKeys: wrappedEnvelope(data.encryptedDeviceKeys),
  });
}
/** Explicit recovery-code creation is the sole export of the backup credential.
 * Subsequent loads expose public keys and authenticated ciphertext only. No
 * derived signing, encryption or content private key enters JS or any journal. */
export class NativeRecoverySigner {
  private constructor(
    private readonly invoke: NativeInvoke,
    readonly material: OnboardingPublic,
  ) {}
  static async create(
    invoke: NativeInvoke,
    profile: string,
    network: NetworkName,
  ) {
    profileCheck(profile);
    const value = await call(invoke, "fm_onboarding_create", {
      profile,
      network,
    });
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new NativeDeviceError("invalid_response");
    const data = value as Record<string, unknown>;
    if (typeof data.recoveryCode !== "string" || data.recoveryCode.length > 100)
      throw new NativeDeviceError("invalid_response");
    try {
      const parsed = parseRecoveryCode(data.recoveryCode);
      parsed.entropy.fill(0);
      if (parsed.network !== network) throw new Error();
    } catch {
      throw new NativeDeviceError("invalid_response");
    }
    return {
      signer: new NativeRecoverySigner(
        invoke,
        bundle(data.public, profile, network),
      ),
      recoveryCode: data.recoveryCode,
    };
  }
  static async load(
    invoke: NativeInvoke,
    profile: string,
    network: NetworkName,
  ) {
    profileCheck(profile);
    return new NativeRecoverySigner(
      invoke,
      bundle(
        await call(invoke, "fm_onboarding_public", { profile, network }),
        profile,
        network,
      ),
    );
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
    const value = await call(this.invoke, "fm_onboarding_sign_transaction", {
      profile: this.material.device.profile,
      network: this.material.network,
      bytes: encoded,
    });
    if (!value || typeof value !== "object")
      throw new NativeDeviceError("invalid_response");
    const data = value as Record<string, unknown>;
    if (data.bytes !== encoded || typeof data.signature !== "string")
      throw new NativeDeviceError("invalid_response");
    try {
      const signature = fromBase64(data.signature);
      if (
        signature.length !== 97 ||
        toBase64(signature) !== data.signature ||
        signature[0] !== 0 ||
        toBase64(signature.slice(65)) !==
          this.material.recovery.signingPublicKey
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
