import { fromBase64, toBase64 } from "@mysten/sui/utils";
import {
  bytesToHex,
  randomContentKey,
  wrapKeys,
} from "@fractalmind-labs/fractalmind-sdk";
import type { ConnectionProfile, Agent } from "./domain";
import { call, NativeDeviceSigner, type NativeInvoke } from "./native-device";

export type DirectDraft = {
  action: "ask" | "status" | "file.read" | "file.write";
  message: string;
  path: string;
  requestRoots: string;
  content: string;
  calls: string;
};
type Storage = Pick<globalThis.Storage, "getItem" | "setItem" | "removeItem">;
type Scope = {
  network: ConnectionProfile["network"];
  chain: string;
  human: string;
  organization: string;
  managed: string;
  instance: string;
  host: string;
  deviceProfile: string;
  deviceAddress: string;
};
type Saved = {
  format: 1;
  scope: Scope;
  token: string;
  savedAt: number;
  encryptedKeys?: string;
  encryptedBody?: string;
  attemptedRequest?: string;
};
export class DirectDraftError extends Error {
  constructor(
    readonly code:
      | "draft_invalid"
      | "draft_changed"
      | "draft_storage_unavailable",
  ) {
    super(code);
  }
}
const invalid = () => new DirectDraftError("draft_invalid");
const id = /^0x[0-9a-f]{64}$/;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const request = /^[A-Za-z0-9._:/@+\-]{1,128}$/;
function decode(value: unknown, magic: string, maximum: number) {
  if (typeof value !== "string" || value.length > Math.ceil(maximum / 3) * 4)
    throw invalid();
  const bytes = fromBase64(value);
  if (
    bytes.length < (magic === "FMW1" ? 100 : 32) ||
    bytes.length > maximum ||
    toBase64(bytes) !== value ||
    new TextDecoder().decode(bytes.slice(0, 4)) !== magic
  )
    throw invalid();
  return value;
}
function draft(value: unknown): DirectDraft {
  if (!value || typeof value !== "object") throw invalid();
  const d = value as DirectDraft;
  if (
    !["ask", "status", "file.read", "file.write"].includes(d.action) ||
    [d.message, d.path, d.requestRoots, d.content, d.calls].some(
      (v) => typeof v !== "string",
    ) ||
    d.message.length > 4096 ||
    d.path.length > 4096 ||
    d.requestRoots.length > 4096 ||
    d.calls.length > 16 ||
    new TextEncoder().encode(JSON.stringify(d)).length > 60000
  )
    throw invalid();
  // Editing may be incomplete. Only the original sending controller validates
  // paths, budgets and permission; a local working copy cannot grant any.
  return {
    action: d.action,
    message: d.message,
    path: d.path,
    requestRoots: d.requestRoots,
    content: d.content,
    calls: d.calls,
  };
}

/** A disposable, device-local working copy. No chain authority or organization
 * key is cached. A fresh draft-only content key is sealed to the OS device's
 * public encryption key; its private key never crosses the native boundary.
 * Reuse the native record cipher, with a distinct, fully scoped logical ID.
 * Storage revision checks detect observed changes, not an atomic cross-window
 * CAS. The original transaction journal and chain guards remain authoritative.
 */
export class NativeDirectDraft {
  private original: string | null | undefined;
  private constructor(
    private readonly scope: Scope,
    private readonly publicKey: string,
    private readonly logicalId: string,
    readonly storageKey: string,
    private readonly invoke: NativeInvoke,
    private readonly storage: Storage,
    private readonly assertCurrent: () => void,
  ) {}
  static async open(
    profile: ConnectionProfile,
    organizationId: string,
    managed: Pick<Agent, "id" | "instance_id" | "host_address">,
    deviceProfile: string,
    invoke: NativeInvoke,
    storage: Storage,
    assertCurrent: () => void = () => {},
  ) {
    const device = (await NativeDeviceSigner.load(invoke, deviceProfile))
      .device;
    assertCurrent();
    if (
      !profile.chainIdentifier ||
      profile.chainIdentifier.length > 128 ||
      ![
        profile.humanId,
        organizationId,
        managed.id,
        managed.host_address,
      ].every((v) => id.test(v)) ||
      !managed.instance_id ||
      managed.instance_id.length > 512
    )
      throw invalid();
    const scope: Scope = {
      network: profile.network,
      chain: profile.chainIdentifier,
      human: profile.humanId,
      organization: organizationId,
      managed: managed.id,
      instance: managed.instance_id,
      host: managed.host_address,
      deviceProfile,
      deviceAddress: device.address,
    };
    const digest = bytesToHex(
      new Uint8Array(
        await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(JSON.stringify(scope)),
        ),
      ),
    );
    assertCurrent();
    const store = new NativeDirectDraft(
      scope,
      device.encryptionPublicKey,
      `local-direct-draft:${digest}`,
      `fractalmind.app.local-direct-draft.v1:${digest}`,
      invoke,
      storage,
      assertCurrent,
    );
    store.original = store.current();
    return store;
  }
  private current() {
    this.assertCurrent();
    try {
      return this.storage.getItem(this.storageKey);
    } catch {
      throw new DirectDraftError("draft_storage_unavailable");
    }
  }
  private write(next: string | null, expected = this.original) {
    if (
      expected === undefined ||
      this.original !== expected ||
      this.current() !== expected
    )
      throw new DirectDraftError("draft_changed");
    try {
      if (next === null) this.storage.removeItem(this.storageKey);
      else this.storage.setItem(this.storageKey, next);
      if (this.storage.getItem(this.storageKey) !== next) throw new Error();
    } catch {
      throw new DirectDraftError("draft_storage_unavailable");
    }
    this.original = next;
  }
  private parse(raw: string): Saved {
    if (raw.length > 180000) throw invalid();
    const value = JSON.parse(raw) as Saved;
    if (
      value.format !== 1 ||
      JSON.stringify(value.scope) !== JSON.stringify(this.scope) ||
      !uuid.test(value.token) ||
      !Number.isSafeInteger(value.savedAt) ||
      value.savedAt <= 0 ||
      (value.attemptedRequest !== undefined &&
        !request.test(value.attemptedRequest))
    )
      throw invalid();
    if (!value.attemptedRequest || value.encryptedKeys || value.encryptedBody) {
      decode(value.encryptedKeys, "FMW1", 65636);
      decode(value.encryptedBody, "FME1", 65536);
    }
    return value;
  }
  private header(encryptedKeys: string) {
    return {
      network: this.scope.network,
      encryptedKeys,
      organizationId: this.scope.organization,
      kind: 6,
      logicalId: this.logicalId,
      revision: "1",
      keyVersion: "1",
    };
  }
  async restore(): Promise<
    | { state: "empty" }
    | { state: "attempted"; requestId: string }
    | { state: "saved"; draft: DirectDraft; savedAt: number }
  > {
    const raw = this.current();
    this.original = raw;
    if (!raw) return { state: "empty" };
    const saved = this.parse(raw);
    // Never present a submission attempt, including a lost response, as a new
    // unsent message. The original controller/journal resolves its outcome.
    if (saved.attemptedRequest)
      return { state: "attempted", requestId: saved.attemptedRequest };
    if (!saved.encryptedKeys || !saved.encryptedBody) throw invalid();
    const result = await call(this.invoke, "fm_device_decrypt_record", {
      profile: this.scope.deviceProfile,
      record: JSON.stringify({
        ...this.header(saved.encryptedKeys),
        encryptedBody: saved.encryptedBody,
      }),
    });
    if (typeof result !== "string" || result.length > 87340) throw invalid();
    const plaintext = fromBase64(result);
    try {
      if (plaintext.length > 65504 || toBase64(plaintext) !== result)
        throw invalid();
      const value = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(plaintext),
      );
      if (
        value.format !== 1 ||
        value.token !== saved.token ||
        value.savedAt !== saved.savedAt ||
        JSON.stringify(value.scope) !== JSON.stringify(this.scope)
      )
        throw invalid();
      if (this.current() !== raw) throw new DirectDraftError("draft_changed");
      return {
        state: "saved",
        draft: draft(value.draft),
        savedAt: saved.savedAt,
      };
    } finally {
      plaintext.fill(0);
    }
  }
  async save(input: DirectDraft) {
    const content = draft(input),
      token = crypto.randomUUID(),
      savedAt = Date.now();
    // Capturing the current baseline must precede all native/crypto awaits.
    if (this.original === undefined || this.current() !== this.original)
      throw new DirectDraftError("draft_changed");
    const expected = this.original;
    const secret = randomContentKey();
    let keys: Uint8Array | undefined;
    let plaintext: Uint8Array | undefined;
    try {
      const hex = bytesToHex(secret);
      keys = new TextEncoder().encode(
        JSON.stringify({
          format: 2,
          organizations: {
            [this.scope.organization]: {
              currentVersion: "1",
              contentKey: hex,
              historicalKeys: { "1": hex },
            },
          },
        }),
      );
      const encryptedKeys = toBase64(
        await wrapKeys(
          keys,
          fromBase64(this.publicKey),
          `fractalmind.device-keys.v1:${this.scope.network}:${this.scope.deviceAddress}`,
        ),
      );
      plaintext = new TextEncoder().encode(
        JSON.stringify({
          format: 1,
          scope: this.scope,
          token,
          savedAt,
          draft: content,
        }),
      );
      const encryptedBody = decode(
        await call(this.invoke, "fm_device_encrypt_record", {
          profile: this.scope.deviceProfile,
          record: JSON.stringify({
            ...this.header(encryptedKeys),
            plaintext: toBase64(plaintext),
          }),
        }),
        "FME1",
        65536,
      );
      this.write(
        JSON.stringify({
          format: 1,
          scope: this.scope,
          token,
          savedAt,
          encryptedKeys,
          encryptedBody,
        } satisfies Saved),
        expected,
      );
      return savedAt;
    } finally {
      secret.fill(0);
      keys?.fill(0);
      plaintext?.fill(0);
    }
  }
  markAttempted(requestId: string) {
    if (!request.test(requestId)) throw invalid();
    if (this.original === undefined || this.current() !== this.original)
      throw new DirectDraftError("draft_changed");
    // Even an unsaved submission leaves a marker, so an earlier asynchronous
    // save cannot restore the old text as an unsent draft after submission.
    const value: Saved = this.original
      ? this.parse(this.original)
      : {
          format: 1,
          scope: this.scope,
          token: crypto.randomUUID(),
          savedAt: Date.now(),
        };
    this.write(JSON.stringify({ ...value, attemptedRequest: requestId }));
  }
  discard() {
    this.write(null);
  }
}
