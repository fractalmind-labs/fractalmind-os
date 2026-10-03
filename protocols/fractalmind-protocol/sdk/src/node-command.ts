import { toBigInt } from './client.js';
import type { CapabilityReference, NodeCommandSigningInput, NodeCommandSigner, SignNodeCommandInput, SignedNodeCommand } from './types.js';

export const NODE_COMMAND_SIGNATURE_DOMAIN = 'fractalmind.node-command.v1';

/** Sign the command domain directly, rather than a wallet personal-message
 * domain. The payload is normalized once, so its hash covers the sent bytes. */
export async function signNodeCommand(signer: NodeCommandSigner, input: SignNodeCommandInput): Promise<SignedNodeCommand> {
  const publicKey = signer.getPublicKey();
  const publicBytes = publicKey.toRawBytes();
  if (publicBytes.length !== 32) throw new Error('NodeCommand requires an Ed25519 device key.');
  const issuedAtMs = input.issuedAtMs ?? Date.now();
  const expiresAtMs = input.expiresAtMs ?? issuedAtMs + 60_000;
  assertSafeTimestamp(issuedAtMs, 'issuedAtMs');
  assertSafeTimestamp(expiresAtMs, 'expiresAtMs');
  if (issuedAtMs <= 0 || expiresAtMs <= issuedAtMs || expiresAtMs - issuedAtMs > 300_000) {
    throw new Error('NodeCommand must have a positive timestamp and a TTL of at most five minutes.');
  }
  const payloadText = JSON.stringify(input.payload ?? {});
  const payload = JSON.parse(payloadText) as Record<string, unknown>;
  if (!payload || Array.isArray(payload) || typeof payload !== 'object') throw new Error('Payload must be a JSON object.');
  const payloadHash = hex(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(payloadText))));
  const commandId = input.commandId ?? globalThis.crypto.randomUUID();
  const signing: NodeCommandSigningInput = {
    version: '1', commandId, signer: publicKey.toSuiAddress(), target: input.target,
    action: input.action, scope: input.scope, capability: input.capability,
    nonce: input.nonce ?? globalThis.crypto.randomUUID(),
    issuedAtMs, expiresAtMs, idempotencyKey: input.idempotencyKey ?? commandId,
    ...(input.budget ? { budget: input.budget } : {}), payloadHash,
  };
  for (const token of [signing.commandId, signing.signer, input.target.organizationId,
    input.target.nodeId, input.action, input.scope, input.capability.id, signing.nonce, signing.idempotencyKey]) {
    assertSigningToken(token);
  }
  if (input.target.agentId) assertSigningToken(input.target.agentId);
  if (input.budget) assertSigningToken(input.budget.asset);
  const bytes = canonicalNodeCommandSigningBytes(signing);
  const signature = await signer.sign(bytes);
  if (signature.length !== 64) throw new Error('Invalid Ed25519 signature length.');
  const { domain: _domain, ...wire } = JSON.parse(new TextDecoder().decode(bytes)) as Omit<SignedNodeCommand, 'payload' | 'signature'> & { domain: string };
  return { ...wire, payload, signature: `ed25519:${hex(publicBytes)}:${hex(signature)}` };
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function assertSigningToken(value: string): void {
  if (!/^[A-Za-z0-9._:/@+\-]+$/.test(value)) throw new Error('Signed identifiers must use the canonical ASCII token alphabet.');
}

export function capabilityReferenceWire(reference: CapabilityReference): {
  id: string;
  revocation_version: string;
} {
  return {
    id: reference.id,
    revocation_version: toBigInt(reference.revocationVersion).toString(10),
  };
}

export function canonicalNodeCommandSigningBytes(input: NodeCommandSigningInput): Uint8Array {
  assertSafeTimestamp(input.issuedAtMs, 'issuedAtMs');
  assertSafeTimestamp(input.expiresAtMs, 'expiresAtMs');
  if (input.expiresAtMs <= input.issuedAtMs) {
    throw new Error('expiresAtMs must be greater than issuedAtMs.');
  }

  const target = {
    organization_id: input.target.organizationId,
    node_id: input.target.nodeId,
    ...(input.target.agentId ? { agent_id: input.target.agentId } : {}),
  };
  const budget = input.budget
    ? {
        asset: input.budget.asset,
        amount: positiveU64Decimal(input.budget.amount, 'budget amount'),
      }
    : undefined;
  const envelope = {
    domain: NODE_COMMAND_SIGNATURE_DOMAIN,
    version: input.version,
    command_id: input.commandId,
    signer: input.signer,
    target,
    action: input.action,
    scope: input.scope,
    capability: capabilityReferenceWire(input.capability),
    nonce: input.nonce,
    issued_at_ms: input.issuedAtMs,
    expires_at_ms: input.expiresAtMs,
    idempotency_key: input.idempotencyKey,
    budget,
    payload_hash: input.payloadHash,
  };

  return new TextEncoder().encode(JSON.stringify(envelope));
}

function assertSafeTimestamp(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a nonnegative safe integer.`);
  }
}

function positiveU64Decimal(value: bigint | number | string, name: string): string {
  const parsed = toBigInt(value);
  if (parsed === 0n) {
    throw new Error(`${name} must be greater than zero.`);
  }
  return parsed.toString(10);
}
