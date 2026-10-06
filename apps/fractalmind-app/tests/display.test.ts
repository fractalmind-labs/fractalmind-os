import assert from "node:assert/strict";
import test from "node:test";
import {
  actionLabel,
  agentName,
  hostName,
  initial,
  shortId,
} from "../src/display";

const zh = (a: string) => a;
const en = (_: string, b: string) => b;
const address =
  "0xffa58c11223344556677889900aabbccddeeff00112233445566778899700b93";

test("shortId keeps short values and abbreviates chain IDs", () => {
  assert.equal(shortId(undefined), "—");
  assert.equal(shortId("primary"), "primary");
  assert.equal(shortId(address), "0xffa58c…700b93");
});

test("hostName prefers the membership name", () => {
  assert.equal(hostName({ name: "Mac mini M4", host_address: address }), "Mac mini M4");
  assert.equal(hostName({ name: "  ", host_address: address }), "0xffa58c…700b93");
  assert.equal(hostName({ host_address: address }), "0xffa58c…700b93");
});

test("agentName shows the runtime with a short instance ID", () => {
  assert.equal(
    agentName({ runtime: "bounded-process-v1", instance_id: "native-b0f907fcd70b00370193884cc2595fc77c7235bd" }),
    "bounded-process-v1 · native-b0f907f…",
  );
  assert.equal(agentName({ runtime: "codex", instance_id: "builder-1" }), "codex · builder-1");
});

test("actionLabel translates known direct actions only", () => {
  assert.equal(actionLabel("file.write", zh), "写入文件");
  assert.equal(actionLabel("file.read", en), "Read files");
  assert.equal(actionLabel("custom.tool", zh), "custom.tool");
});

test("initial handles names with multi-byte first characters", () => {
  assert.equal(initial("ada's org"), "A");
  assert.equal(initial("分形实验室"), "分");
  assert.equal(initial(""), "?");
});
