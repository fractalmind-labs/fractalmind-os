export const NODE_COMMAND_SIGNATURE_DOMAIN = "fractalmind.node-command.v1";
export const NODE_COMMAND_PROTOCOL_VERSION = "1";

export type Uint64DecimalString = string;
export type HexString = string;

export interface NodeCommandTarget {
  organization_id: string;
  node_id: string;
  agent_id?: string;
}

export interface NodeCommandCapabilityRef {
  id: string;
  revocation_version: Uint64DecimalString;
}

export interface NodeCommandBudgetClaim {
  asset: string;
  amount: Uint64DecimalString;
}

export interface NodeCommand {
  version: typeof NODE_COMMAND_PROTOCOL_VERSION;
  command_id: string;
  signer: string;
  target: NodeCommandTarget;
  action: string;
  scope: string;
  capability: NodeCommandCapabilityRef;
  nonce: string;
  issued_at_ms: number;
  expires_at_ms: number;
  idempotency_key: string;
  budget?: NodeCommandBudgetClaim;
  payload?: unknown;
  payload_hash: HexString;
  signature: string;
}

export interface NodeEvent {
  version: typeof NODE_COMMAND_PROTOCOL_VERSION;
  event_id: string;
  command_id: string;
  target: NodeCommandTarget;
  type: string;
  result_code: string;
  result_hash?: HexString;
  evidence_hash?: HexString;
  occurred_at_ms: number;
}

export interface NodeCommandGoldenFixture {
  command: NodeCommand;
  payload_hex: HexString;
  signing_bytes_hex: HexString;
  event: NodeEvent;
  event_bytes_hex: HexString;
}

export interface NodeCommandSigningEnvelope {
  domain: typeof NODE_COMMAND_SIGNATURE_DOMAIN;
  version: typeof NODE_COMMAND_PROTOCOL_VERSION;
  command_id: string;
  signer: string;
  target: NodeCommandTarget;
  action: string;
  scope: string;
  capability: NodeCommandCapabilityRef;
  nonce: string;
  issued_at_ms: number;
  expires_at_ms: number;
  idempotency_key: string;
  budget?: NodeCommandBudgetClaim;
  payload_hash: HexString;
}

const MAX_U64 = (1n << 64n) - 1n;

export function canonicalNodeCommandSigningEnvelope(command: NodeCommand): NodeCommandSigningEnvelope {
  assertSafeTimestamp(command.issued_at_ms, "issued_at_ms");
  assertSafeTimestamp(command.expires_at_ms, "expires_at_ms");
  if (command.expires_at_ms <= command.issued_at_ms) {
    throw new Error("expires_at_ms must be greater than issued_at_ms");
  }

  return {
    domain: NODE_COMMAND_SIGNATURE_DOMAIN,
    version: command.version,
    command_id: command.command_id,
    signer: command.signer,
    target: canonicalTarget(command.target),
    action: command.action,
    scope: command.scope,
    capability: canonicalCapability(command.capability),
    nonce: command.nonce,
    issued_at_ms: command.issued_at_ms,
    expires_at_ms: command.expires_at_ms,
    idempotency_key: command.idempotency_key,
    ...(command.budget ? { budget: canonicalBudget(command.budget) } : {}),
    payload_hash: command.payload_hash,
  };
}

export function canonicalNodeCommandSigningBytes(command: NodeCommand): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(canonicalNodeCommandSigningEnvelope(command)));
}

export function canonicalNodeCommandSigningHex(command: NodeCommand): HexString {
  return bytesToHex(canonicalNodeCommandSigningBytes(command));
}

export async function hashNodeCommandPayload(payload: Uint8Array): Promise<HexString> {
  if (!globalThis.crypto?.subtle) {
    throw new Error("WebCrypto SHA-256 is unavailable in this runtime");
  }
  const buffer = new ArrayBuffer(payload.byteLength);
  new Uint8Array(buffer).set(payload);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", buffer);
  return bytesToHex(new Uint8Array(digest));
}

export function bytesToHex(bytes: Uint8Array): HexString {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function hexToBytes(hex: HexString): Uint8Array {
  if (!/^(?:[0-9a-f]{2})*$/u.test(hex)) {
    throw new Error("hex must be lowercase and byte-aligned");
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function canonicalTarget(target: NodeCommandTarget): NodeCommandTarget {
  return {
    organization_id: target.organization_id,
    node_id: target.node_id,
    ...(target.agent_id ? { agent_id: target.agent_id } : {}),
  };
}

function canonicalCapability(capability: NodeCommandCapabilityRef): NodeCommandCapabilityRef {
  return {
    id: capability.id,
    revocation_version: assertUint64Decimal(capability.revocation_version, "capability.revocation_version"),
  };
}

function canonicalBudget(budget: NodeCommandBudgetClaim): NodeCommandBudgetClaim {
  return {
    asset: budget.asset,
    amount: assertPositiveUint64Decimal(budget.amount, "budget.amount"),
  };
}

function assertSafeTimestamp(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a nonnegative safe integer`);
  }
}

function assertPositiveUint64Decimal(value: Uint64DecimalString, name: string): Uint64DecimalString {
  const parsed = parseUint64Decimal(value, name);
  if (parsed === 0n) {
    throw new Error(`${name} must be greater than zero`);
  }
  return value;
}

function assertUint64Decimal(value: Uint64DecimalString, name: string): Uint64DecimalString {
  parseUint64Decimal(value, name);
  return value;
}

function parseUint64Decimal(value: Uint64DecimalString, name: string): bigint {
  if (typeof value !== "string") {
    throw new Error(`${name} must be a uint64 decimal string`);
  }
  if (!/^(0|[1-9][0-9]*)$/u.test(value)) {
    throw new Error(`${name} must be a uint64 decimal string`);
  }
  const parsed = BigInt(value);
  if (parsed > MAX_U64) {
    throw new Error(`${name} exceeds uint64 max`);
  }
  return parsed;
}
