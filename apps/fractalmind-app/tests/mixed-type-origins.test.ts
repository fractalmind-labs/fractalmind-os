import test from "node:test";
import assert from "node:assert/strict";
import { bcs, TypeTagSerializer } from "@mysten/sui/bcs";
import type { ClientWithCoreApi } from "@mysten/sui/client";
import {
  deriveDynamicFieldID,
  normalizeSuiAddress as id,
} from "@mysten/sui/utils";
import { FractalMindSDK } from "@fractalmind-labs/fractalmind-sdk";
import { readRecordPointer } from "../src/record-pointer";
import type { ChainReadSession } from "../src/chain";

const original = id("0x42"),
  introduced = id("0x43"),
  current = id("0x44");
const org = id("0x50"),
  table = id("0x51"),
  record = id("0x52");
const Index = bcs.struct("RecordIndex", {
  key_version: bcs.u64(),
  records: bcs.struct("Table", { id: bcs.Address, size: bcs.u64() }),
});
const Pointer = bcs.struct("RecordPointer", {
  record_id: bcs.Address,
  revision: bcs.u64(),
  key_version: bcs.u64(),
});

function fixture(
  mode:
    | "valid"
    | "absent"
    | "wrongType"
    | "wrongOriginal"
    | "unavailable"
    | "missingType" = "valid",
) {
  let packageReads = 0,
    fieldReads = 0;
  const types = [
    [
      "organization",
      "Organization",
      mode === "wrongOriginal" ? current : original,
    ],
    ["organization", "ProtocolRegistry", original],
    ["product_record", "IndexBinding", introduced],
    ["product_record", "RecordIndex", introduced],
    ["product_record", "RecordPointer", introduced],
    ...(mode === "missingType"
      ? []
      : [["product_record", "RecordKey", current]]),
  ].map(([moduleName, datatypeName, origin]) => ({
    moduleName,
    datatypeName,
    package: origin,
  }));
  const objectBcs = bcs.Object.serialize({
    data: {
      Package: {
        id: current,
        version: "3",
        moduleMap: new Map(),
        typeOriginTable: types,
        linkageTable: new Map(),
      },
    },
    owner: { Immutable: true },
    previousTransaction: "11111111111111111111111111111111",
    storageRebate: "0",
  }).toBytes();
  const core = {
    getObject: async ({ objectId }: { objectId: string }) => {
      assert.equal(objectId, current);
      packageReads++;
      if (mode === "unavailable")
        throw new Error("immutable package unavailable");
      return {
        object: {
          objectId,
          type: "package",
          version: "3",
          owner: { $kind: "Immutable" },
          objectBcs,
        },
      };
    },
    getDynamicField: async ({
      parentId,
      name,
    }: {
      parentId: string;
      name: { type: string; bcs: Uint8Array };
    }) => {
      fieldReads++;
      if (parentId === org) {
        assert.equal(name.type, `${introduced}::product_record::IndexBinding`);
        return {
          dynamicField: {
            value: {
              type: `${introduced}::product_record::RecordIndex`,
              bcs: Index.serialize({
                key_version: "1",
                records: { id: table, size: "1" },
              }).toBytes(),
            },
          },
        };
      }
      assert.equal(parentId, table);
      assert.equal(name.type, `${current}::product_record::RecordKey`);
      if (mode === "absent")
        throw {
          reason: "notFound",
          objectId: deriveDynamicFieldID(
            parentId,
            TypeTagSerializer.parseFromStr(name.type),
            name.bcs,
          ),
        };
      return {
        dynamicField: {
          value: {
            type: `${mode === "wrongType" ? current : introduced}::product_record::RecordPointer`,
            bcs: Pointer.serialize({
              record_id: record,
              revision: "1",
              key_version: "1",
            }).toBytes(),
          },
        },
      };
    },
  };
  const sdk = new FractalMindSDK({
    packageId: current,
    originalPackageId: original,
    client: { network: "localnet", core } as unknown as ClientWithCoreApi,
  });
  return {
    chain: { sdk } as ChainReadSession,
    reads: () => ({ packageReads, fieldReads }),
  };
}

test("App point lookup resolves each datatype separately across three package versions", async () => {
  const f = fixture();
  const result = await readRecordPointer(f.chain, org, "message", "discussion");
  assert.equal(result.pointer?.record_id, record);
  assert.equal(result.keyVersion, "1");
  await readRecordPointer(f.chain, org, "message", "discussion");
  assert.deepEqual(f.reads(), { packageReads: 1, fieldReads: 6 });
  const absent = fixture("absent");
  assert.equal(
    (await readRecordPointer(absent.chain, org, "message", "discussion"))
      .pointer,
    undefined,
  );
});

test("missing/foreign package metadata and substituted pointer origins cannot become an empty or successful App read", async () => {
  for (const mode of [
    "wrongOriginal",
    "unavailable",
    "missingType",
    "wrongType",
  ] as const) {
    const f = fixture(mode);
    await assert.rejects(
      readRecordPointer(f.chain, org, "message", "discussion"),
    );
    if (mode === "wrongOriginal" || mode === "unavailable")
      assert.equal(f.reads().fieldReads, 0);
  }
});
