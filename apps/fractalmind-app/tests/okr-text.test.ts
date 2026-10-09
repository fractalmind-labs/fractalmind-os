import assert from "node:assert/strict";
import test from "node:test";
import { okrSpecLogicalId, OkrTextError, parseOkrSpec } from "../src/okr-text";

const encode = (value: unknown) =>
  new TextEncoder().encode(typeof value === "string" ? value : JSON.stringify(value));
const spec = {
  schema: "fractalmind.okr-spec.v1",
  objective: "发布可在三大桌面系统安装运行的桌面 Alpha",
  successCriteria: "…",
  priority: 0,
  krs: [{ title: "三平台签名安装包通过签名与哈希校验" }, { title: "冷启动 < 3s" }],
};

test("parseOkrSpec returns the objective and KR titles", () => {
  const text = parseOkrSpec(encode(spec));
  assert.equal(text.objective, spec.objective);
  assert.deepEqual(text.krTitles, ["三平台签名安装包通过签名与哈希校验", "冷启动 < 3s"]);
  assert.ok(Object.isFrozen(text));
});

test("parseOkrSpec rejects other schemas and malformed bodies", () => {
  const bad = [
    "not json",
    new Uint8Array([0xff, 0xfe]),
    { ...spec, schema: "fractalmind.okr-spec.v0" },
    { ...spec, objective: "  " },
    { ...spec, objective: "x".repeat(513) },
    { ...spec, krs: [] },
    { ...spec, krs: [{}, {}, {}, {}] },
    { ...spec, krs: [{ title: 3 }] },
    { ...spec, krs: [{ title: "x".repeat(257) }] },
    null,
  ];
  for (const value of bad) {
    const bytes = value instanceof Uint8Array ? value : encode(value);
    assert.throws(
      () => parseOkrSpec(bytes),
      (e) => e instanceof OkrTextError && e.code === "invalid_spec",
    );
  }
});

test("spec records use the draft's logical ID", () => {
  assert.equal(okrSpecLogicalId("ae169c54"), "okr-ae169c54-spec");
});
