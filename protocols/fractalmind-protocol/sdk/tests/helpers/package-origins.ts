import { bcs } from '@mysten/sui/bcs';
import { normalizeSuiAddress } from '@mysten/sui/utils';

/** Existing v0.2 fixture types introduced by its first publication retain that
 * origin on a later upgrade. Each fixture declares only the datatypes it uses. */
export function withPackageOrigins<T extends object>(core: T, current: string, original: string, types: string[]) {
  const packageId = normalizeSuiAddress(current), origin = normalizeSuiAddress(original);
  const typeOriginTable = ['organization::Organization', 'organization::ProtocolRegistry', ...types].map(key => {
    const [moduleName, datatypeName] = key.split('::');
    return { moduleName, datatypeName, package: origin };
  });
  const objectBcs = bcs.Object.serialize({
    data: { Package: { id: packageId, version: '2', moduleMap: new Map(), typeOriginTable, linkageTable: new Map() } },
    owner: { Immutable: true }, previousTransaction: '11111111111111111111111111111111', storageRebate: '0',
  }).toBytes();
  return { ...core, getObject: async (input: { objectId: string }) => {
    if (input.objectId === packageId) return { object: { objectId: packageId, type: 'package', version: '2', owner: { $kind: 'Immutable' }, objectBcs } };
    const method = (core as { getObject?: (input: { objectId: string }) => unknown }).getObject;
    if (!method) throw new Error('Unexpected fixture object read');
    return method(input);
  } };
}
