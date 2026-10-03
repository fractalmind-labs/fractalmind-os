import { bcs } from "@mysten/sui/bcs";
import {
  PRODUCT_RECORD_KINDS,
  type ProductRecordKind,
} from "@fractalmind-labs/fractalmind-sdk";
import { ChainReadSession, missingDynamicField } from "./chain";
import type { RecordPointer } from "./private-records";
import { canonical } from "./handover-plan";

const Index = bcs.struct("RecordIndex", {
  key_version: bcs.u64(),
  records: bcs.struct("Table", { id: bcs.Address, size: bcs.u64() }),
});
const Key = bcs.struct("RecordKey", {
  kind: bcs.u8(),
  logical_id: bcs.string(),
});
const Pointer = bcs.struct("RecordPointer", {
  record_id: bcs.Address,
  revision: bcs.u64(),
  key_version: bcs.u64(),
});
const id = /^0x[0-9a-f]{64}$/;
export class RecordPointerError extends Error {
  constructor(readonly code: "invalid_source" | "snapshot_changed") {
    super(code);
  }
}
/** Point lookup of a known logical record. A lagging pagination index is not
 * absence. Only the exact missing child field in a verified table is absent;
 * a missing root, transport failure or changed table remains an error. */
export async function readRecordPointer(
  chain: ChainReadSession,
  organizationId: string,
  kind: ProductRecordKind,
  logicalId: string,
) {
  if (
    !id.test(organizationId) ||
    !PRODUCT_RECORD_KINDS[kind] ||
    !logicalId ||
    new TextEncoder().encode(logicalId).length > 128
  )
    throw new RecordPointerError("invalid_source");
  const core = chain.sdk.client.client.core;
  const index = async () => {
    const { dynamicField } = await core.getDynamicField({
      parentId: organizationId,
      name: {
        type: await chain.sdk.client.coreType("product_record", "IndexBinding"),
        bcs: new Uint8Array([0]),
      },
    });
    if (
      dynamicField.value.type !==
      (await chain.sdk.client.coreType("product_record", "RecordIndex"))
    )
      throw new RecordPointerError("invalid_source");
    const value = Index.parse(dynamicField.value.bcs);
    if (BigInt(value.key_version) < 1n || !id.test(value.records.id))
      throw new RecordPointerError("invalid_source");
    return value;
  };
  const before = await index(),
    name = {
      type: await chain.sdk.client.coreType("product_record", "RecordKey"),
      bcs: Key.serialize({
        kind: PRODUCT_RECORD_KINDS[kind],
        logical_id: logicalId,
      }).toBytes(),
    };
  let pointer: RecordPointer | undefined;
  try {
    const { dynamicField } = await core.getDynamicField({
      parentId: before.records.id,
      name,
    });
    if (
      dynamicField.value.type !==
      (await chain.sdk.client.coreType("product_record", "RecordPointer"))
    )
      throw new RecordPointerError("invalid_source");
    const value = Pointer.parse(dynamicField.value.bcs);
    if (
      !id.test(value.record_id) ||
      BigInt(value.revision) < 1n ||
      BigInt(value.key_version) < 1n ||
      BigInt(value.key_version) > BigInt(before.key_version)
    )
      throw new RecordPointerError("invalid_source");
    pointer = { ...value, kind: PRODUCT_RECORD_KINDS[kind], logicalId };
  } catch (error) {
    if (!missingDynamicField(error, before.records.id, name.type, name.bcs))
      throw error;
  }
  if (canonical(await index()) !== canonical(before))
    throw new RecordPointerError("snapshot_changed");
  return { keyVersion: before.key_version, pointer };
}
