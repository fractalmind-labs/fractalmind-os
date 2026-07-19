import { toBigInt } from './client';
import type { CapabilityReference, NodeCommandSigningInput } from './types';

export const NODE_COMMAND_SIGNATURE_DOMAIN = 'fractalmind.node-command.v1';

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
