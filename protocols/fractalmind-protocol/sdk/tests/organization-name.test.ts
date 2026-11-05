import assert from 'node:assert/strict';
import test from 'node:test';
import { bcs, TypeTagSerializer } from '@mysten/sui/bcs';
import { deriveDynamicFieldID, normalizeSuiAddress } from '@mysten/sui/utils';
import { FractalMindSDK } from '../src/index.js';

const pkg = normalizeSuiAddress('0x11');
const registryId = normalizeSuiAddress('0x22');
const names = normalizeSuiAddress('0x33');
const existing = normalizeSuiAddress('0x44');
const Table = bcs.struct('Table', { id: bcs.Address, size: bcs.u64() });
const Registry = bcs.struct('ProtocolRegistry', {
  id: bcs.Address,
  organizations: Table,
  name_registry: Table,
  org_count: bcs.u64(),
});

function sdkFor(nameValue: string | null) {
  const client = {
    network: 'localnet',
    core: {
      getObject: async ({ objectId }: { objectId: string }) => {
        assert.equal(objectId, registryId);
        return {
          object: {
            objectId: registryId,
            type: `${pkg}::organization::ProtocolRegistry`,
            owner: { $kind: 'Shared' },
            content: Registry.serialize({
              id: registryId,
              organizations: { id: normalizeSuiAddress('0x55'), size: '0' },
              name_registry: { id: names, size: '1' },
              org_count: '1',
            }).toBytes(),
          },
        };
      },
      getDynamicField: async ({ parentId, name }: { parentId: string; name: { type: string; bcs: Uint8Array } }) => {
        assert.equal(parentId, names);
        assert.equal(name.type, '0x1::string::String');
        assert.equal(bcs.string().parse(name.bcs), 'A shared name');
        if (nameValue)
          return { dynamicField: { value: { bcs: bcs.Address.serialize(nameValue).toBytes() } } };
        const objectId = deriveDynamicFieldID(
          names,
          TypeTagSerializer.parseFromStr('0x1::string::String'),
          name.bcs,
        );
        throw { reason: 'notFound', objectId };
      },
    },
  };
  return new FractalMindSDK({ packageId: pkg, registryId, client: client as never, network: 'localnet' });
}

test('organization name lookup reads the global String-keyed registry table', async () => {
  assert.deepEqual(await sdkFor(existing).organization.findByName('A shared name'), {
    registryId,
    organizationId: existing,
  });
  assert.deepEqual(await sdkFor(null).organization.findByName('A shared name'), {
    registryId,
    organizationId: null,
  });
  await assert.rejects(sdkFor(null).organization.findByName(' A shared name '), /trimmed/);
});
