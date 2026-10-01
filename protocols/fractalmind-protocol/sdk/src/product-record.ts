import { bcs } from '@mysten/sui/bcs';
import type { Transaction } from '@mysten/sui/transactions';
import { normalizeSuiAddress } from '@mysten/sui/utils';
import { FractalMindClient, toBigInt } from './client.js';
import { encryptContent, decryptContent } from './identity-crypto.js';
import { bytesArgument } from './wire-bytes.js';

export const PRODUCT_RECORD_KINDS = Object.freeze({ okr: 1, contract: 2, approval: 3, evidence: 4, checkpoint: 5, message: 6, backup: 7 } as const);
export type ProductRecordKind = keyof typeof PRODUCT_RECORD_KINDS;
const ID = bcs.Address;
const EmptyBinding = bcs.struct('IndexBinding', { dummy_field: bcs.bool() });
const Key = bcs.struct('RecordKey', { kind: bcs.u8(), logical_id: bcs.string() });
const Pointer = bcs.struct('RecordPointer', { record_id: ID, revision: bcs.u64(), key_version: bcs.u64() });
const Index = bcs.struct('RecordIndex', { key_version: bcs.u64(), records: bcs.struct('Table', { id: ID, size: bcs.u64() }) });
export const EncryptedRecordBcs = bcs.struct('EncryptedRecord', {
  id: ID, organization_id: ID, kind: bcs.u8(), logical_id: bcs.string(), revision: bcs.u64(), key_version: bcs.u64(),
  previous: bcs.option(ID), writer_human: ID, writer_device: ID, grant_id: ID, grant_version: bcs.u64(),
  created_at_ms: bcs.u64(), encrypted_body: bcs.vector(bcs.u8()),
});

export function recordContext(organizationId: string, kind: ProductRecordKind, logicalId: string, revision: bigint | string | number, keyVersion: bigint | string | number): string {
  if (!PRODUCT_RECORD_KINDS[kind]) throw new Error('Invalid product record kind.');
  return `fractalmind.product-record.v1:${normalizeSuiAddress(organizationId)}:${PRODUCT_RECORD_KINDS[kind]}:${JSON.stringify(logicalId)}:${toBigInt(revision)}:${toBigInt(keyVersion)}`;
}

export class ProductRecordApi {
  private readonly typesPackageId: string;
  constructor(private readonly fm: FractalMindClient, typesPackageId?: string) {
    this.typesPackageId = normalizeSuiAddress(typesPackageId ?? fm.typesPackageId);
  }
  save(input: { organizationId: string; humanId: string; grantId: string; kind: ProductRecordKind; logicalId: string; expectedRevision: bigint | string | number; keyVersion: bigint | string | number; encryptedBody: Uint8Array; tx?: Transaction }): Transaction {
    if (input.encryptedBody.length < 32 || input.encryptedBody.length > 65536) throw new Error('Encrypted body must be 32..65536 bytes.');
    const tx = this.fm.useTransaction(input.tx);
    tx.moveCall({ target: `${this.fm.packageId}::product_record::save`, arguments: [tx.object(input.organizationId), tx.object(input.humanId), tx.object(input.grantId), tx.pure.u8(PRODUCT_RECORD_KINDS[input.kind]), tx.pure.string(input.logicalId), tx.pure.u64(toBigInt(input.expectedRevision)), tx.pure.u64(toBigInt(input.keyVersion)), bytesArgument(tx, this.fm.packageId, input.encryptedBody), tx.object('0x6')] });
    return tx;
  }
  async encryptAndSave(input: { organizationId: string; humanId: string; grantId: string; kind: ProductRecordKind; logicalId: string; expectedRevision: bigint | string | number; keyVersion: bigint | string | number; plaintext: Uint8Array; key: Uint8Array; tx?: Transaction }): Promise<Transaction> {
    if (input.plaintext.length > 65504) throw new Error('Plaintext exceeds the encrypted 64 KiB record capacity.');
    const context = recordContext(input.organizationId, input.kind, input.logicalId, toBigInt(input.expectedRevision) + 1n, input.keyVersion);
    const encryptedBody = await encryptContent(input.plaintext, input.key, context);
    return this.save({ ...input, encryptedBody });
  }
  async getRecord(recordId: string) {
    const { object } = await this.fm.client.core.getObject({ objectId: recordId, include: { content: true } });
    if (object.type !== `${this.typesPackageId}::product_record::EncryptedRecord` || !object.content || object.owner.$kind !== 'Immutable') throw new Error('Unexpected encrypted record type, content, or ownership.');
    return EncryptedRecordBcs.parse(object.content);
  }
  rotateKey(input: { organizationId: string; humanId: string; grantId: string; expectedKeyVersion: bigint | string | number; tx?: Transaction }): Transaction {
    const tx = this.fm.useTransaction(input.tx);
    tx.moveCall({ target: `${this.fm.packageId}::product_record::rotate_key`, arguments: [tx.object(input.organizationId), tx.object(input.humanId), tx.object(input.grantId), tx.pure.u64(toBigInt(input.expectedKeyVersion)), tx.object('0x6')] });
    return tx;
  }
  rotateKeyForRecovery(input: { organizationId: string; humanId: string; recordId: string; expectedKeyVersion: bigint | string | number; tx?: Transaction }): Transaction {
    const tx = this.fm.useTransaction(input.tx);
    tx.moveCall({ target: `${this.fm.packageId}::product_record::rotate_key_for_recovery`, arguments: [tx.object(input.organizationId), tx.object(input.humanId), tx.object(input.recordId), tx.pure.u64(toBigInt(input.expectedKeyVersion))] });
    return tx;
  }
  async decryptRecord(recordId: string, key: Uint8Array) {
    const record = await this.getRecord(recordId);
    const kind = Object.entries(PRODUCT_RECORD_KINDS).find(([, id]) => id === record.kind)?.[0] as ProductRecordKind | undefined;
    if (!kind) throw new Error('Unsupported encrypted record kind.');
    const plaintext = await decryptContent(Uint8Array.from(record.encrypted_body), key, recordContext(record.organization_id, kind, record.logical_id, record.revision, record.key_version));
    return { record, plaintext };
  }
  async listCurrent(organizationId: string, cursor?: string | null, limit = 50) {
    const binding = await this.fm.client.core.getDynamicField({ parentId: organizationId, name: { type: `${this.typesPackageId}::product_record::IndexBinding`, bcs: EmptyBinding.serialize({ dummy_field: false }).toBytes() } });
    const index = Index.parse(binding.dynamicField.value.bcs);
    const page = await this.fm.client.core.listDynamicFields({ parentId: index.records.id, cursor, limit });
    const records = await Promise.all(page.dynamicFields.map(async field => {
      const key = Key.parse(field.name.bcs);
      const response = await this.fm.client.core.getDynamicField({ parentId: index.records.id, name: field.name });
      const pointer = Pointer.parse(response.dynamicField.value.bcs);
      return { kind: key.kind, logicalId: key.logical_id, ...pointer };
    }));
    if (page.hasNextPage && (!page.cursor || page.cursor === cursor)) throw new Error('Record index returned a missing or repeated cursor.');
    return { records, keyVersion: index.key_version, cursor: page.hasNextPage ? page.cursor : null, hasNextPage: page.hasNextPage };
  }
}
