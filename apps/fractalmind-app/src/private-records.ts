import { fromBase64, toBase64 } from "@mysten/sui/utils";
import {
  PRODUCT_RECORD_KINDS,
  type ProductRecordKind,
} from "@fractalmind-labs/fractalmind-sdk";
import { call, type NativeInvoke, NativeDeviceSigner } from "./native-device";
import { DeviceIdentityVerifier } from "./device-identity";
import { ChainReadSession, missingIndex } from "./chain";

export class PrivateRecordError extends Error {
  constructor(
    readonly code:
      | "invalid_record"
      | "invalid_response"
      | "authority_changed"
      | "directory_changed",
  ) {
    super(code);
  }
}
export type RecordPointer = {
  kind: number;
  logicalId: string;
  record_id: string;
  revision: string;
  key_version: string;
};
const id = /^0x[0-9a-f]{64}$/;
function kindName(value: number) {
  const found = Object.entries(PRODUCT_RECORD_KINDS).find(
    ([, n]) => n === value,
  )?.[0];
  if (!found) throw new PrivateRecordError("invalid_record");
  return found as ProductRecordKind;
}
/** Ciphertext comes from the chain. Plaintext exists in memory only; no keyring,
 * key export, business cache, or public-profile-only decrypt path is provided. */
export class PrivateRecords {
  private readonly verifier: DeviceIdentityVerifier;
  constructor(
    readonly chain: ChainReadSession,
    readonly signer: NativeDeviceSigner,
    readonly grantId: string,
    readonly organizationId: string,
    private readonly invoke: NativeInvoke,
  ) {
    if (!id.test(organizationId))
      throw new PrivateRecordError("invalid_record");
    this.verifier = new DeviceIdentityVerifier(chain, signer, grantId);
  }
  async list() {
    const before = await this.verifier.verifyOrganization(this.organizationId);
    const rows: RecordPointer[] = [];
    let cursor: string | null = null;
    const seen = new Set<string>();
    do {
      const page: {
        records: RecordPointer[];
        cursor: string | null;
        hasNextPage: boolean;
      } = await this.chain.sdk.productRecord
        .listCurrent(this.organizationId, cursor, 50)
        .catch(async (error) => {
          // Only the exact missing organization index on the first page is empty.
          // Missing child records, later pages and transport failures stay errors.
          if (
            cursor === null &&
            missingIndex(
              error,
              this.organizationId,
              await this.chain.sdk.client.coreType(
                "product_record",
                "IndexBinding",
              ),
            )
          )
            return { records: [], cursor: null, hasNextPage: false };
          throw error;
        });
      for (const row of page.records) {
        kindName(row.kind);
        if (
          !id.test(row.record_id) ||
          !row.logicalId ||
          new TextEncoder().encode(row.logicalId).length > 128 ||
          BigInt(row.revision) < 1n ||
          BigInt(row.key_version) < 1n
        )
          throw new PrivateRecordError("invalid_record");
        rows.push(row);
      }
      if (!page.hasNextPage) break;
      if (!page.cursor || seen.has(page.cursor) || rows.length > 1000)
        throw new PrivateRecordError("invalid_record");
      seen.add(page.cursor);
      cursor = page.cursor;
    } while (cursor);
    const after = await this.verifier.verifyOrganization(this.organizationId);
    if (before.authorityPin !== after.authorityPin)
      throw new PrivateRecordError("authority_changed");
    return rows;
  }
  async read(pointer: RecordPointer, historical = false): Promise<Uint8Array> {
    // Snapshot caller data before crossing any asynchronous boundary.
    const requested = { ...pointer },
      kind = kindName(requested.kind);
    if (
      !id.test(requested.record_id) ||
      !/^[1-9][0-9]{0,19}$/.test(requested.revision) ||
      !/^[1-9][0-9]{0,19}$/.test(requested.key_version)
    )
      throw new PrivateRecordError("invalid_record");
    const before = await this.verifier.verifyOrganization(this.organizationId);
    const head = {
      ...(await this.chain.sdk.productRecord.getCurrent(
        this.organizationId,
        kind,
        requested.logicalId,
      )),
    };
    if (
      !historical &&
      (head.record_id !== requested.record_id ||
        head.revision !== requested.revision ||
        head.key_version !== requested.key_version)
    )
      throw new PrivateRecordError("directory_changed");
    let record = await this.chain.sdk.productRecord.getRecord(head.record_id);
    let expectedRevision = BigInt(head.revision);
    const seen = new Set<string>();
    for (;;) {
      if (
        seen.has(record.id) ||
        seen.size >= 1000 ||
        record.organization_id !== this.organizationId ||
        record.kind !== requested.kind ||
        record.logical_id !== requested.logicalId ||
        BigInt(record.revision) !== expectedRevision ||
        (record.revision === "1") !== (record.previous === null)
      )
        throw new PrivateRecordError("invalid_record");
      seen.add(record.id);
      if (record.id === requested.record_id) break;
      if (
        !historical ||
        !record.previous ||
        BigInt(record.revision) <= BigInt(requested.revision)
      )
        throw new PrivateRecordError("directory_changed");
      expectedRevision--;
      record = await this.chain.sdk.productRecord.getRecord(record.previous);
    }
    if (
      record.organization_id !== this.organizationId ||
      record.kind !== requested.kind ||
      record.logical_id !== requested.logicalId ||
      record.revision !== requested.revision ||
      record.key_version !== requested.key_version ||
      !before.encryptedKeys
    )
      throw new PrivateRecordError("invalid_record");
    const body = toBase64(Uint8Array.from(record.encrypted_body));
    const result = await call(this.invoke, "fm_device_decrypt_record", {
      profile: this.signer.device.profile,
      record: JSON.stringify({
        network: this.chain.profile.network,
        encryptedKeys: before.encryptedKeys,
        organizationId: this.organizationId,
        kind: record.kind,
        logicalId: record.logical_id,
        revision: record.revision,
        keyVersion: record.key_version,
        encryptedBody: body,
      }),
    });
    if (typeof result !== "string" || result.length > 87340)
      throw new PrivateRecordError("invalid_response");
    let plaintext: Uint8Array;
    try {
      plaintext = fromBase64(result);
      if (plaintext.length > 65504 || toBase64(plaintext) !== result) {
        plaintext.fill(0);
        throw new Error();
      }
    } catch {
      throw new PrivateRecordError("invalid_response");
    }
    try {
      const after = await this.verifier.verifyOrganization(this.organizationId);
      const current = await this.chain.sdk.productRecord.getCurrent(
        this.organizationId,
        kind,
        requested.logicalId,
      );
      if (after.authorityPin !== before.authorityPin)
        throw new PrivateRecordError("authority_changed");
      if (
        current.record_id !== head.record_id ||
        current.revision !== head.revision ||
        current.key_version !== head.key_version
      )
        throw new PrivateRecordError("directory_changed");
      return plaintext;
    } catch (error) {
      plaintext.fill(0);
      throw error;
    }
  }
}
