import assert from 'node:assert/strict';
import test from 'node:test';
import { bcs } from '@mysten/sui/bcs';
import type { ClientWithCoreApi } from '@mysten/sui/client';
import { normalizeSuiAddress } from '@mysten/sui/utils';
import { FractalMindSDK, IdentityRegistryBcs } from '../src/index.js';

const old = normalizeSuiAddress('0x11'), current = normalizeSuiAddress('0x22');
const protocol = normalizeSuiAddress('0x33'), identity = normalizeSuiAddress('0x44');
const origins = [
  ['organization', 'Organization', old], ['organization', 'ProtocolRegistry', old],
  ['remote_authority', 'RemoteCapability', old], ['remote_authority', 'BoundBudgetKey', current],
  ['identity', 'RegistryBinding', current], ['identity', 'IdentityRegistry', current],
].map(([moduleName, datatypeName, packageId]) => ({ moduleName, datatypeName, package: packageId }));
function envelope(table = origins) {
  return bcs.Object.serialize({
    data: { Package: { id: current, version: '2', moduleMap: new Map(), typeOriginTable: table, linkageTable: new Map() } },
    owner: { Immutable: true }, previousTransaction: '11111111111111111111111111111111', storageRebate: '0',
  }).toBytes();
}
function fixture(table = origins) {
  let packageReads = 0;
  const client = { network: 'localnet', core: {
    getObject: async ({ objectId }: { objectId: string }) => {
      if (objectId === current) {
        packageReads++;
        return { object: { objectId, type: 'package', version: '2', owner: { $kind: 'Immutable' }, objectBcs: envelope(table) } };
      }
      assert.equal(objectId, identity);
      return { object: { objectId, type: `${current}::identity::IdentityRegistry`, content: IdentityRegistryBcs.serialize({
        id: identity, protocol_registry: protocol, recoveries: { id: normalizeSuiAddress('0x55'), size: '0' }, devices: { id: normalizeSuiAddress('0x66'), size: '0' },
      }).toBytes() } };
    },
    getDynamicField: async ({ parentId, name }: { parentId: string; name: { type: string } }) => {
      assert.equal(parentId, protocol);
      assert.equal(name.type, `${current}::identity::RegistryBinding`);
      return { dynamicField: { value: { bcs: bcs.Address.serialize(identity).toBytes() } } };
    },
  } } as unknown as ClientWithCoreApi;
  return { sdk: new FractalMindSDK({ packageId: current, originalPackageId: old, registryId: protocol, client, network: 'localnet' }), reads: () => packageReads };
}

test('upgrade reads the exact immutable type table, including new types in an existing module', async () => {
  const f = fixture();
  assert.throws(() => f.sdk.client.coreTypeTag('identity', 'RegistryBinding'), /unavailable/);
  const [capability, budget, registry] = await Promise.all([
    f.sdk.client.coreType('remote_authority', 'RemoteCapability'),
    f.sdk.client.coreType('remote_authority', 'BoundBudgetKey'),
    f.sdk.identity.resolveRegistry(),
  ]);
  assert.equal(capability, `${old}::remote_authority::RemoteCapability`);
  assert.equal(budget, `${current}::remote_authority::BoundBudgetKey`);
  assert.equal(registry, identity);
  assert.equal(f.reads(), 1);
  assert.equal(await f.sdk.identity.resolveRegistry(), identity);
  assert.equal(f.reads(), 1);
  await assert.rejects(f.sdk.client.coreType('identity', 'MissingType'), /unavailable/);
});

test('foreign or duplicate origin tables never become a usable authorization type source', async () => {
  const wrong = origins.map(o => o.datatypeName === 'Organization' ? { ...o, package: current } : o);
  for (const [table, message] of [[wrong, /does not match/], [[...origins, origins[0]], /duplicate/]] as const) {
    const f = fixture([...table]);
    await assert.rejects(f.sdk.client.loadCoreTypeOrigins(), message);
    assert.throws(() => f.sdk.client.coreTypeTag('identity', 'RegistryBinding'), /unavailable/);
    // A rejected fetch does not cache a guessed map or an indefinitely rejected
    // promise. A later explicit read can inspect the authoritative package again.
    await assert.rejects(f.sdk.client.loadCoreTypeOrigins(), message);
    assert.equal(f.reads(), 2);
  }
});
