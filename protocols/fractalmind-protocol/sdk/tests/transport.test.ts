import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ClientWithCoreApi } from '@mysten/sui/client';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { FractalMindClient, readOptionId, readOptionBigInt } from '../src/client.js';

test('default transport is gRPC', () => {
  const client = new FractalMindClient({ packageId: '0x2', network: 'testnet' });
  assert(client.client instanceof SuiGrpcClient);
});

test('Core API reads include JSON and paginate with opaque cursors', async () => {
  const calls: unknown[] = [];
  const core = {
    async listOwnedObjects(request: { cursor?: string | null }) {
      calls.push(request);
      const first = !request.cursor;
      return {
        objects: [{ objectId: first ? '0x1' : '0x2', type: '0x3::test::Item', json: { value: '18446744073709551615' } }],
        cursor: first ? 'opaque-page-2' : null,
        hasNextPage: first,
      };
    },
  };
  const client = new FractalMindClient({ packageId: '0x3', client: { core } as unknown as ClientWithCoreApi });
  const items = await client.getOwnedMoveObjects('0x1', '0x3::test::Item');
  assert.equal(items.length, 2);
  assert.equal(items[1].fields.value, '18446744073709551615');
  assert.equal((calls[1] as { cursor: string }).cursor, 'opaque-page-2');
  assert.deepEqual((calls[0] as { include: unknown }).include, { json: true });
});

test('native Move JSON option forms preserve exact u64 values', () => {
  for (const value of ['18446744073709551615', ['18446744073709551615'], { vec: ['18446744073709551615'] }]) {
    assert.equal(readOptionBigInt({ value }, 'value'), 18446744073709551615n);
  }
  assert.equal(readOptionBigInt({ value: null }, 'value'), null);
  assert.equal(readOptionId({ value: [] }, 'value'), null);
  assert.match(readOptionId({ value: '0x1' }, 'value')!, /^0x0+1$/);
});

test('owned-object reads reject missing page cursors', async () => {
  const core = { async listOwnedObjects() { return { objects: [], hasNextPage: true, cursor: null }; } };
  const client = new FractalMindClient({ packageId: '0x3', client: { core } as unknown as ClientWithCoreApi });
  await assert.rejects(client.getOwnedMoveObjects('0x1', '0x3::test::Item'), /cursor/);
});
