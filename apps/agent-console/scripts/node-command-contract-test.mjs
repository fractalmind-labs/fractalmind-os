import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { test } from "node:test";
import ts from "typescript";

const FIXTURE_PATH = new URL("../src/lib/testdata/node-command-v1-golden.json", import.meta.url);
const CODEC_SOURCE_PATH = new URL("../src/lib/node-command.ts", import.meta.url);
const CODEC_RUNTIME_PATH = new URL("../node_modules/.cache/agent-console-node-command-test/node-command.mjs", import.meta.url);
const CANONICAL_FIXTURE_SHA256 = "f4fb11b9194abbafad3bd1a674c0dc4895f14b726f2f24d8862feeb95c9e8a44";
const {
  bytesToHex,
  canonicalNodeCommandSigningBytes,
  canonicalNodeCommandSigningEnvelope,
  canonicalNodeCommandSigningHex,
  hashNodeCommandPayload,
  hexToBytes,
  NODE_COMMAND_SIGNATURE_DOMAIN,
} = await loadCodec();

async function loadFixture() {
  const raw = await readFile(FIXTURE_PATH, "utf8");
  return { raw, fixture: JSON.parse(raw) };
}

async function loadCodec() {
  const source = await readFile(CODEC_SOURCE_PATH, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2021,
    },
    fileName: "node-command.ts",
  }).outputText;
  await mkdir(new URL(".", CODEC_RUNTIME_PATH), { recursive: true });
  await writeFile(CODEC_RUNTIME_PATH, output);
  return import(CODEC_RUNTIME_PATH.href);
}

test("checked-in v1 fixture remains byte-for-byte pinned to protocol/envd golden", async () => {
  const { raw, fixture } = await loadFixture();
  const hash = createHash("sha256").update(raw).digest("hex");
  assert.equal(hash, CANONICAL_FIXTURE_SHA256);
  assert.deepEqual(Object.keys(fixture), ["command", "payload_hex", "signing_bytes_hex", "event", "event_bytes_hex"]);
  assert.deepEqual(Object.keys(fixture.command), [
    "version",
    "command_id",
    "signer",
    "target",
    "action",
    "scope",
    "capability",
    "nonce",
    "issued_at_ms",
    "expires_at_ms",
    "idempotency_key",
    "budget",
    "payload_hash",
    "signature",
  ]);
});

test("canonical signing bytes match the shared v1 golden vector", async () => {
  const { fixture } = await loadFixture();
  assert.equal(canonicalNodeCommandSigningHex(fixture.command), fixture.signing_bytes_hex);
  assert.equal(bytesToHex(canonicalNodeCommandSigningBytes(fixture.command)), fixture.signing_bytes_hex);
});

test("payload hash binds the exact payload bytes, not JSON object ordering", async () => {
  const { fixture } = await loadFixture();
  const payload = hexToBytes(fixture.payload_hex);
  assert.equal(await hashNodeCommandPayload(payload), fixture.command.payload_hash);
  assert.notEqual(await hashNodeCommandPayload(new Uint8Array([...payload, 0x20])), fixture.command.payload_hash);
  const first = new TextEncoder().encode(JSON.stringify({ agent_id: "agent-1", mode: "safe" }));
  const reordered = new TextEncoder().encode(JSON.stringify({ mode: "safe", agent_id: "agent-1" }));
  assert.notEqual(await hashNodeCommandPayload(first), await hashNodeCommandPayload(reordered));
});

test("canonical signing envelope uses deterministic protocol field order", async () => {
  const { fixture } = await loadFixture();
  const envelope = canonicalNodeCommandSigningEnvelope(fixture.command);
  assert.deepEqual(Object.keys(envelope), [
    "domain",
    "version",
    "command_id",
    "signer",
    "target",
    "action",
    "scope",
    "capability",
    "nonce",
    "issued_at_ms",
    "expires_at_ms",
    "idempotency_key",
    "budget",
    "payload_hash",
  ]);
  assert.equal(envelope.domain, NODE_COMMAND_SIGNATURE_DOMAIN);
  assert.deepEqual(Object.keys(envelope.target), ["organization_id", "node_id", "agent_id"]);
  assert.deepEqual(Object.keys(envelope.capability), ["id", "revocation_version"]);
  assert.deepEqual(Object.keys(envelope.budget), ["asset", "amount"]);
});

test("uint64 authority and budget values remain decimal strings across max-u64", async () => {
  const { fixture } = await loadFixture();
  const max = "18446744073709551615";
  const command = structuredClone(fixture.command);
  command.capability.revocation_version = max;
  command.budget.amount = max;
  const envelope = canonicalNodeCommandSigningEnvelope(command);
  assert.equal(envelope.capability.revocation_version, max);
  assert.equal(envelope.budget.amount, max);
  assert.equal(typeof envelope.capability.revocation_version, "string");
  assert.equal(typeof envelope.budget.amount, "string");
  assert.throws(() => canonicalNodeCommandSigningEnvelope({ ...command, capability: { ...command.capability, revocation_version: "18446744073709551616" } }), /exceeds uint64 max/);
  assert.throws(() => canonicalNodeCommandSigningEnvelope({ ...command, budget: { ...command.budget, amount: 42 } }), /uint64 decimal string/);
});

test("omitted optional agent and budget fields stay omitted from signing bytes", async () => {
  const { fixture } = await loadFixture();
  const command = structuredClone(fixture.command);
  delete command.target.agent_id;
  delete command.budget;
  const json = new TextDecoder().decode(canonicalNodeCommandSigningBytes(command));
  assert.match(json, /"target":\{"organization_id":"org-1","node_id":"node-1"\}/);
  assert.doesNotMatch(json, /agent_id|budget|signature|payload"/);
});
