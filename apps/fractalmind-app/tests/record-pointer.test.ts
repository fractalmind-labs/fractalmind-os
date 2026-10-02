import test from "node:test";
import assert from "node:assert/strict";
import { bcs, TypeTagSerializer } from "@mysten/sui/bcs";
import {
  deriveDynamicFieldID,
  normalizeSuiAddress as id,
} from "@mysten/sui/utils";
import { readRecordPointer } from "../src/record-pointer";
import type { ChainReadSession } from "../src/chain";
const org = id("1"),
  pkg = id("2"),
  table = id("3"),
  record = id("4");
const Index = bcs.struct("RecordIndex", {
  key_version: bcs.u64(),
  records: bcs.struct("Table", { id: bcs.Address, size: bcs.u64() }),
});
const Pointer = bcs.struct("RecordPointer", {
  record_id: bcs.Address,
  revision: bcs.u64(),
  key_version: bcs.u64(),
});
function fixture() {
  let reads = 0,
    absent = false,
    rootAbsent = false,
    error: unknown,
    swapped = false,
    wrongType = false;
  const pointer = { record_id: record, revision: "1", key_version: "1" };
  const chain = {
    sdk: {
      client: {
        typesPackageId: pkg,
        client: {
          core: {
            listDynamicFields: async () => {
              throw new Error("pagination must not establish absence");
            },
            getDynamicField: async ({
              parentId,
              name,
            }: {
              parentId: string;
              name: { type: string; bcs: Uint8Array };
            }) => {
              if (error) throw error;
              if (
                (parentId === org && rootAbsent) ||
                (parentId === table && absent)
              )
                throw {
                  reason: "notFound",
                  objectId: deriveDynamicFieldID(
                    parentId,
                    TypeTagSerializer.parseFromStr(name.type),
                    name.bcs,
                  ),
                };
              if (parentId === org) {
                reads++;
                return {
                  dynamicField: {
                    value: {
                      type: `${pkg}::product_record::RecordIndex`,
                      bcs: Index.serialize({
                        key_version: swapped && reads > 1 ? "2" : "1",
                        records: { id: table, size: "2" },
                      }).toBytes(),
                    },
                  },
                };
              }
              assert.equal(parentId, table);
              assert.equal(name.type, `${pkg}::product_record::RecordKey`);
              return {
                dynamicField: {
                  value: {
                    type: wrongType
                      ? `${pkg}::wrong::RecordPointer`
                      : `${pkg}::product_record::RecordPointer`,
                    bcs: Pointer.serialize(pointer).toBytes(),
                  },
                },
              };
            },
          },
        },
      },
    },
  } as unknown as ChainReadSession;
  return {
    chain,
    pointer,
    change: (v: {
      absent?: boolean;
      rootAbsent?: boolean;
      error?: unknown;
      swapped?: boolean;
      wrongType?: boolean;
    }) => {
      absent = v.absent ?? absent;
      rootAbsent = v.rootAbsent ?? rootAbsent;
      error = v.error ?? error;
      swapped = v.swapped ?? swapped;
      wrongType = v.wrongType ?? wrongType;
    },
  };
}
test("known record point lookup bypasses lagging pagination; only exact missing child is absent", async () => {
  const f = fixture();
  assert.equal(
    (await readRecordPointer(f.chain, org, "checkpoint", "review")).pointer!
      .record_id,
    record,
  );
  f.change({ absent: true });
  assert.equal(
    (await readRecordPointer(f.chain, org, "checkpoint", "review")).pointer,
    undefined,
  );
});
test("missing root/foreign child/RPC failures and substituted pointers cannot become an empty record", async () => {
  for (const mutate of [
    (f: ReturnType<typeof fixture>) => f.change({ rootAbsent: true }),
    (f: ReturnType<typeof fixture>) =>
      f.change({ error: { reason: "notFound", objectId: id("ff") } }),
    (f: ReturnType<typeof fixture>) =>
      f.change({ error: new Error("rpc unavailable") }),
    (f: ReturnType<typeof fixture>) => f.change({ wrongType: true }),
    (f: ReturnType<typeof fixture>) => {
      f.pointer.revision = "0";
    },
    (f: ReturnType<typeof fixture>) => {
      f.pointer.key_version = "2";
    },
  ]) {
    const f = fixture();
    mutate(f);
    await assert.rejects(
      readRecordPointer(f.chain, org, "checkpoint", "review"),
    );
  }
});
test("key/table changes during present or absent lookup invalidate the snapshot", async () => {
  for (const absent of [false, true]) {
    const f = fixture();
    f.change({ absent, swapped: true });
    await assert.rejects(
      readRecordPointer(f.chain, org, "checkpoint", "review"),
      /snapshot_changed/,
    );
  }
});
