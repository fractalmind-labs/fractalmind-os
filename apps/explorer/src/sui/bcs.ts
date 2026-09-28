/**
 * BCS schemas for the Move structs this explorer reads.
 *
 * GraphQL (unlike the deprecated JSON-RPC) returns Move object content as
 * raw BCS bytes, not decoded JSON fields, so this app decodes them itself.
 * Field lists were checked against the current contract source
 * (protocols/fractalmind-protocol/contracts/protocol/sources/*.move and
 * runtime/fractalmind-envd/contracts/envd/sources/*.move) and then verified
 * against the actual bytes of every live object on testnet as of 2026-09-28
 * (see the object IDs in ./config.ts).
 *
 * `Task` is the one place those two didn't agree: the deployed contract's
 * `Task` struct does not have the `key_result_id: Option<ID>` field that is
 * present in the current source, likely added after the last deployment.
 * Sui's upgrade compatibility rules don't allow changing an existing
 * struct's layout, so every already-published `Task` still uses the old,
 * narrower shape; the schema below matches what's actually on chain, not
 * the source file. If the contract is redeployed with that field wired up
 * as an actual struct member (rather than a dynamic field, which wouldn't
 * affect this), decoding `Task` will need to change again.
 */
import { bcs } from "@mysten/bcs";
import type { BcsType } from "@mysten/bcs";

/** A Sui address / object ID / UID: 32 raw bytes, read out as "0x…" hex. */
export const Address = bcs.bytes(32).transform({
  input: (value: Uint8Array) => value,
  output: (value) => `0x${bytesToHex(value)}`,
});

function bytesToHex(bytes: Uint8Array): string {
  let hex = "";
  for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
  return hex;
}

/** sui::table::Table<K, V> — entries live as dynamic fields on `id`, not inline. */
export const Table = bcs.struct("Table", {
  id: Address,
  size: bcs.u64(),
});

export const ProtocolRegistry = bcs.struct("ProtocolRegistry", {
  id: Address,
  organizations: Table,
  name_registry: Table,
  org_count: bcs.u64(),
});

export const Organization = bcs.struct("Organization", {
  id: Address,
  name: bcs.string(),
  description: bcs.string(),
  admin: Address,
  is_active: bcs.bool(),
  agents: Table,
  agent_count: bcs.u64(),
  tasks: Table,
  task_count: bcs.u64(),
  parent_org: bcs.option(Address),
  child_orgs: Table,
  child_org_count: bcs.u64(),
  depth: bcs.u64(),
  created_at: bcs.u64(),
});

export const AgentCertificate = bcs.struct("AgentCertificate", {
  id: Address,
  org_id: Address,
  agent: Address,
  capability_tags: bcs.vector(bcs.string()),
  status: bcs.u8(),
  tasks_completed: bcs.u64(),
  reputation_score: bcs.u64(),
});

// See the module-level note: no `key_result_id` field on chain yet.
export const Task = bcs.struct("Task", {
  id: Address,
  org_id: Address,
  creator: Address,
  title: bcs.string(),
  description: bcs.string(),
  status: bcs.u8(),
  assignee: bcs.option(Address),
  submission: bcs.option(bcs.string()),
  verifier: bcs.option(Address),
  created_at: bcs.u64(),
  assigned_at: bcs.option(bcs.u64()),
  submitted_at: bcs.option(bcs.u64()),
  completed_at: bcs.option(bcs.u64()),
});

export const AgentProfile = bcs.struct("AgentProfile", {
  id: Address,
  org_id: Address,
  agent: Address,
  name: bcs.string(),
  avatar_url: bcs.string(),
  updated_at: bcs.u64(),
});

export const PeerRegistry = bcs.struct("PeerRegistry", {
  id: Address,
  peers: Table,
  peer_count: bcs.u64(),
});

// Unlike the other structs here, no peer has ever been registered on
// testnet (PeerRegistry.peer_count is 0), so this schema is transcribed
// from runtime/fractalmind-envd/contracts/envd/sources/peer.move but not
// verified against a live object the way the others above are.
export const PeerNode = bcs.struct("PeerNode", {
  org_id: Address,
  cert_id: Address,
  wireguard_pubkey: bcs.vector(bcs.u8()),
  endpoints: bcs.vector(bcs.string()),
  hostname: bcs.string(),
  status: bcs.u8(),
  registered_at: bcs.u64(),
  last_updated: bcs.u64(),
});

export type InferOutput<T> = T extends BcsType<infer O, unknown> ? O : never;
