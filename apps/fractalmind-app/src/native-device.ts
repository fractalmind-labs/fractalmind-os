import { Ed25519PublicKey } from "@mysten/sui/keypairs/ed25519";
import { fromBase64, toBase64 } from "@mysten/sui/utils";
import {
  verifyPersonalMessageSignature,
  verifyTransactionSignature,
} from "@mysten/sui/verify";

/** The host supplies this transport. No service name, secret export, shell or
 * file path is accepted from the WebView. Possession is not chain authority. */
export type NativeDeviceCommand =
  | "fm_device_public"
  | "fm_device_initialize"
  | "fm_device_sign_transaction"
  | "fm_device_sign_node_command"
  | "fm_device_prove"
  | "fm_onboarding_create"
  | "fm_onboarding_public"
  | "fm_onboarding_sign_transaction"
  | "fm_device_decrypt_record"
  | "fm_device_encrypt_record"
  | "fm_recovery_import"
  | "fm_recovery_imported_public"
  | "fm_recovery_prepare"
  | "fm_recovery_prepared_public"
  | "fm_recovery_sign_transaction"
  | "fm_device_wrap_organization_keys"
  | "fm_device_wrap_command_result_key"
  | "fm_device_encrypt_command_delivery";
export type NativeInvoke = (
  command: NativeDeviceCommand,
  args: Record<string, string>,
) => Promise<unknown>;
/** Guard both sides of a native permission/signing dialog. A closed or changed
 * UI scope must not release its returned signature for later broadcast. */
export function scopedNativeInvoke(
  invoke: NativeInvoke,
  assertCurrent: () => void,
): NativeInvoke {
  return async (command, args) => {
    assertCurrent();
    const result = await invoke(command, args);
    assertCurrent();
    return result;
  };
}
export type DevicePublic = Readonly<{
  format: 1;
  profile: string;
  address: string;
  signingPublicKey: string;
  encryptionPublicKey: string;
}>;
export class NativeDeviceError extends Error {
  constructor(
    public readonly code:
      | "invalid_profile"
      | "invalid_response"
      | "native_unavailable"
      | "not_initialized"
      | "invalid_transaction"
      | "invalid_command"
      | "invalid_proof"
      | "invalid_recovery"
      | "invalid_envelope"
      | "already_initialized",
  ) {
    super(code);
    this.name = "NativeDeviceError";
  }
}
const id = /^0x[0-9a-f]{64}$/;
const profilePattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
/** Disposable local connection preference; it is never identity authority. */
export function preferredDeviceProfile() {
  try {
    const preferred = JSON.parse(
      localStorage.getItem("fractalmind.app.device-connection.v1") ?? "null",
    );
    if (
      preferred &&
      typeof preferred.profile === "string" &&
      profilePattern.test(preferred.profile)
    )
      return preferred.profile as string;
    const stored = JSON.parse(
      localStorage.getItem("fractalmind.app.onboarding-connection.v1") ??
        "null",
    );
    if (
      stored &&
      typeof stored.profile === "string" &&
      profilePattern.test(stored.profile)
    )
      return stored.profile as string;
  } catch {}
  return "primary";
}
export function profileCheck(profile: string) {
  if (!profilePattern.test(profile))
    throw new NativeDeviceError("invalid_profile");
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new NativeDeviceError("invalid_response");
  return value as Record<string, unknown>;
}
function decode(value: unknown, length: number): Uint8Array {
  if (typeof value !== "string" || value.length !== Math.ceil(length / 3) * 4)
    throw new NativeDeviceError("invalid_response");
  try {
    const bytes = fromBase64(value);
    if (bytes.length !== length || toBase64(bytes) !== value) throw new Error();
    return bytes;
  } catch {
    throw new NativeDeviceError("invalid_response");
  }
}
export function publicResult(value: unknown, profile: string): DevicePublic {
  const result = object(value);
  const pub = new Ed25519PublicKey(decode(result.signingPublicKey, 32));
  decode(result.encryptionPublicKey, 32);
  if (
    result.format !== 1 ||
    result.profile !== profile ||
    typeof result.address !== "string" ||
    !id.test(result.address) ||
    pub.toSuiAddress() !== result.address
  )
    throw new NativeDeviceError("invalid_response");
  return Object.freeze({
    format: 1,
    profile,
    address: result.address,
    signingPublicKey: result.signingPublicKey as string,
    encryptionPublicKey: result.encryptionPublicKey as string,
  });
}
export async function call(
  invoke: NativeInvoke,
  command: NativeDeviceCommand,
  args: Record<string, string>,
) {
  try {
    return await invoke(command, args);
  } catch (error) {
    const code =
      typeof error === "string"
        ? error
        : error instanceof Error
          ? error.message
          : "";
    if (code === "NotInitialized")
      throw new NativeDeviceError("not_initialized");
    if (code === "InvalidRecovery")
      throw new NativeDeviceError("invalid_recovery");
    if (code === "InvalidEnvelope")
      throw new NativeDeviceError("invalid_envelope");
    if (
      code === "InvalidNodeCommand" ||
      (command === "fm_device_sign_node_command" && code === "WrongSender")
    )
      throw new NativeDeviceError("invalid_command");
    if (code === "AlreadyInitialized")
      throw new NativeDeviceError("already_initialized");
    throw new NativeDeviceError("native_unavailable");
  }
}

/** Loading never initializes or replaces a missing/locked device key. The
 * caller must explicitly choose initialization as a separate user action. */
export class NativeDeviceSigner {
  private constructor(
    private readonly invoke: NativeInvoke,
    readonly device: DevicePublic,
  ) {}
  static async load(invoke: NativeInvoke, profile: string) {
    profileCheck(profile);
    return new NativeDeviceSigner(
      invoke,
      publicResult(
        await call(invoke, "fm_device_public", { profile }),
        profile,
      ),
    );
  }
  static async initialize(invoke: NativeInvoke, profile: string) {
    profileCheck(profile);
    return new NativeDeviceSigner(
      invoke,
      publicResult(
        await call(invoke, "fm_device_initialize", { profile }),
        profile,
      ),
    );
  }
  getPublicKey() {
    return new Ed25519PublicKey(decode(this.device.signingPublicKey, 32));
  }
  /** NodeCommandSigner: direct Ed25519 for only the native-validated command
   * domain, not a general raw/personal-message signing capability. */
  async sign(bytes: Uint8Array): Promise<Uint8Array> {
    if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > 8192)
      throw new NativeDeviceError("invalid_command");
    const input = new Uint8Array(bytes),
      encoded = toBase64(input);
    try {
      const value = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(input),
      );
      if (
        value.domain !== "fractalmind.node-command.v1" ||
        value.version !== "1" ||
        value.signer !== this.device.address
      )
        throw new Error();
    } catch {
      throw new NativeDeviceError("invalid_command");
    }
    const result = object(
      await call(this.invoke, "fm_device_sign_node_command", {
        profile: this.device.profile,
        bytes: encoded,
      }),
    );
    if (result.bytes !== encoded)
      throw new NativeDeviceError("invalid_response");
    const signature = decode(result.signature, 64);
    if (!(await this.getPublicKey().verify(input, signature)))
      throw new NativeDeviceError("invalid_response");
    return signature;
  }
  async signTransaction(
    bytes: Uint8Array,
  ): Promise<{ bytes: string; signature: string }> {
    if (
      !(bytes instanceof Uint8Array) ||
      bytes.length === 0 ||
      bytes.length > 1024 * 1024
    )
      throw new NativeDeviceError("invalid_transaction");
    // Snapshot caller bytes before crossing an asynchronous native boundary.
    const input = new Uint8Array(bytes),
      encoded = toBase64(input);
    return this.checkedSignature(
      await call(this.invoke, "fm_device_sign_transaction", {
        profile: this.device.profile,
        bytes: encoded,
      }),
      encoded,
      async (signature) => {
        await verifyTransactionSignature(input, signature, {
          address: this.device.address,
        });
      },
    );
  }
  async proveDevice(
    input: {
      chainIdentifier: string;
      humanId: string;
      grantId: string;
      nonce: string;
      expiresAtMs: number;
    },
    nowMs = Date.now(),
  ) {
    if (
      !/^[A-Za-z0-9]{1,64}$/.test(input.chainIdentifier) ||
      !id.test(input.humanId) ||
      !id.test(input.grantId) ||
      !/^[0-9a-f]{32}$/.test(input.nonce) ||
      !Number.isSafeInteger(nowMs) ||
      nowMs < 0 ||
      !Number.isSafeInteger(input.expiresAtMs) ||
      input.expiresAtMs <= nowMs ||
      input.expiresAtMs - nowMs > 120_000
    )
      throw new NativeDeviceError("invalid_proof");
    const challenge = `FM-DEVICE-PROOF:1:${input.chainIdentifier}:${input.humanId}:${input.grantId}:${input.nonce}:${input.expiresAtMs}`;
    const bytes = new TextEncoder().encode(challenge);
    const result = await this.checkedSignature(
      await call(this.invoke, "fm_device_prove", {
        profile: this.device.profile,
        challenge,
      }),
      toBase64(bytes),
      async (signature) => {
        await verifyPersonalMessageSignature(bytes, signature, {
          address: this.device.address,
        });
      },
    );
    return { ...result, challenge };
  }
  private async checkedSignature(
    value: unknown,
    encoded: string,
    verify: (signature: string) => Promise<void>,
  ) {
    const result = object(value);
    if (result.bytes !== encoded || typeof result.signature !== "string")
      throw new NativeDeviceError("invalid_response");
    const bytes = decode(result.signature, 97);
    if (
      bytes[0] !== 0 ||
      toBase64(bytes.subarray(65)) !== this.device.signingPublicKey
    )
      throw new NativeDeviceError("invalid_response");
    try {
      await verify(result.signature);
    } catch {
      throw new NativeDeviceError("invalid_response");
    }
    return { bytes: encoded, signature: result.signature };
  }
}
