import { withPackageOrigins } from './helpers/package-origins.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import type { ClientWithCoreApi } from '@mysten/sui/client';
import { normalizeSuiAddress as id } from '@mysten/sui/utils';
import { FractalMindClient } from '../src/client.js';
import { ProductRecordApi, EncryptedRecordBcs } from '../src/product-record.js';

type Record = Awaited<ReturnType<ProductRecordApi['getRecord']>>;
function fixture() {
  const original = id('0x42'), org = id('0x10');
  const records = new Map<string, Record>();
  for (let revision = 1; revision <= 3; revision++) {
    const record = EncryptedRecordBcs.parse(EncryptedRecordBcs.serialize({ id: id('0x' + revision), organization_id: org, kind: 1, logical_id: 'okr-spec', revision, key_version: 1, previous: revision === 1 ? null : id('0x' + (revision - 1)), writer_human: id('0xa'), writer_device: id('0xb'), grant_id: id('0xc'), grant_version: 1, created_at_ms: 100 + revision, encrypted_body: new Array(32).fill(0) }).toBytes());
    records.set(record.id, record);
  }
  let rpcFailure = false;
  const core = { getObject: async (input: { objectId: string }) => {
    if (rpcFailure) throw new Error('RPC unavailable');
    const record = records.get(input.objectId); assert.ok(record);
    return { object: { type: `${original}::product_record::EncryptedRecord`, owner: { $kind: 'Immutable' }, content: EncryptedRecordBcs.serialize(record).toBytes() } };
  } };
  const api = new ProductRecordApi(new FractalMindClient({ packageId: '0x99', originalPackageId: original, client: { core: withPackageOrigins(core, '0x99', original, ['product_record::EncryptedRecord']) } as unknown as ClientWithCoreApi }));
  api.getCurrent = async () => ({ record_id: id('0x3'), revision: '3', key_version: '1' });
  return { api, records, org, fail: () => { rpcFailure = true; } };
}

test('history follows immutable revisions across one-record pages with original package types', async () => {
  const { api, org } = fixture(); const revisions: string[] = [];
  let cursor: string | null = null;
  do { const page = await api.listHistory(org, 'okr', 'okr-spec', cursor, 1); revisions.push(...page.records.map(record => record.revision)); cursor = page.cursor; } while (cursor);
  assert.deepEqual(revisions, ['3', '2', '1']);
  await assert.rejects(api.listHistory(org, 'okr', 'okr-spec', '', 1), /cursor/);
  await assert.rejects(api.listHistory(org, 'okr', 'okr-spec', null, 0), /limit/);
});

test('history refuses cross-organization, kind and logical record substitutions', async () => {
  for (const field of ['organization_id', 'kind', 'logical_id'] as const) {
    const { api, records, org } = fixture(); const previous = records.get(id('0x2'))!;
    if (field === 'kind') previous.kind = 4;
    else if (field === 'organization_id') previous.organization_id = id('0xff');
    else previous.logical_id = 'other-spec';
    await assert.rejects(api.listHistory(org, 'okr', 'okr-spec', null, 1), /link/);
  }
});

test('history detects gaps and cycles even at one-record pagination boundaries', async () => {
  for (const mode of ['gap', 'self cycle', 'cross page cycle', 'missing link']) {
    const { api, records, org } = fixture(); const head = records.get(id('0x3'))!;
    if (mode === 'gap') records.get(id('0x2'))!.revision = '1';
    if (mode === 'self cycle') head.previous = head.id;
    if (mode === 'missing link') head.previous = null;
    if (mode === 'cross page cycle') {
      records.get(id('0x2'))!.previous = head.id;
      const page = await api.listHistory(org, 'okr', 'okr-spec', null, 1);
      await assert.rejects(api.listHistory(org, 'okr', 'okr-spec', page.cursor, 1), /link/);
    } else await assert.rejects(api.listHistory(org, 'okr', 'okr-spec', null, 1), /history/);
  }
});

test('record UID mismatch and RPC failures never become an empty successful history', async () => {
  const { api, records, org, fail } = fixture();
  records.get(id('0x3'))!.id = id('0xf');
  await assert.rejects(api.listHistory(org, 'okr', 'okr-spec'), /UID/);
  fail(); await assert.rejects(api.listHistory(org, 'okr', 'okr-spec'), /RPC unavailable/);
});
