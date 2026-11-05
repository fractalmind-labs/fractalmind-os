import { randomUUID } from 'node:crypto';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { fromBase64, normalizeSuiAddress } from '@mysten/sui/utils';
import {
  directMessageRecordName,
  directRequestHash,
  encryptContent,
  hexToBytes,
  recordContext,
  SelfPayTransactionManager,
  TransactionPreflightError,
  unwrapKeys,
  type SelfPayTransactionOutcome,
} from '@fractalmind-labs/fractalmind-sdk';
import type { Transaction } from '@mysten/sui/transactions';
import { authorize, type Authorization } from './auth.js';
import { loadKey } from './keystore.js';
import { EXIT, FmError } from './output.js';
import { FileTransactionJournal } from './storage.js';

const DEFAULT_MAX_FEE = 50_000_000n; // 0.05 SUI
const GAS_BUDGET = 200_000_000n;
const REQUEST_ID = /^[A-Za-z0-9._:/@+\-]{1,128}$/;

export type WriteOptions = { requestId?: string; dryRun: boolean; maxFee?: string };
export type WritePlan = { transaction: Transaction; effect: Record<string, unknown> };

export function requestId(value: string | undefined, operation: string) {
  if (value !== undefined) {
    if (!REQUEST_ID.test(value)) throw new FmError(EXIT.usage, 'usage', '--request-id must be 1..128 characters from A-Z, a-z, 0-9, . _ : / @ + or -.');
    return value;
  }
  return `agent:${operation}:${randomUUID()}`;
}

/** Parse an exact decimal SUI amount into MIST.  Number is deliberately never
 * involved: a fee limit must not be silently rounded up or down. */
export function suiToMist(value: string | undefined) {
  if (value === undefined) return DEFAULT_MAX_FEE;
  if (!/^(0|[1-9][0-9]*)(\.[0-9]{1,9})?$/.test(value))
    throw new FmError(EXIT.usage, 'usage', '--max-fee must be a non-negative SUI decimal with at most nine fractional digits.');
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole!) * 1_000_000_000n + BigInt(fraction.padEnd(9, '0') || '0');
}

function trail(auth: Authorization) {
  return {
    kind: '由 Agent 代为操作',
    grantId: auth.grant.id,
    label: auth.operator.label,
  };
}

function preflight(error: unknown): never {
  if (error instanceof FmError) throw error;
  if (error instanceof TransactionPreflightError) {
    if (['needs_funds', 'gas_unavailable'].includes(error.code))
      throw new FmError(EXIT.needs_funding, 'needs_funding', error.message);
    if (error.code === 'value_limit_exceeded')
      throw new FmError(EXIT.fee_exceeds_limit, 'fee_exceeds_limit', error.message);
    if (['already_recorded', 'stale_quote', 'gas_reserved'].includes(error.code))
      throw new FmError(EXIT.conflict, 'conflict', error.message);
  }
  throw error;
}

function response(outcome: SelfPayTransactionOutcome, effect: Record<string, unknown>, auth: Authorization) {
  return {
    status: outcome.status,
    digest: outcome.digest,
    requestId: outcome.requestId,
    ...(outcome.actualGas ? { actualGasMist: outcome.actualGas } : {}),
    ...(outcome.reason ? { reason: outcome.reason } : {}),
    effect,
    trail: trail(auth),
  };
}

function resolved(outcome: SelfPayTransactionOutcome, effect: Record<string, unknown>, auth: Authorization) {
  const value = response(outcome, effect, auth);
  if (outcome.status === 'unknown')
    throw new FmError(EXIT.chain_unreachable, 'chain_unreachable', 'The original transaction is still not readable; retry only with this same request ID.', value);
  if (outcome.status === 'failed')
    throw new FmError(EXIT.conflict, 'conflict', 'The original transaction failed on chain; refresh state before choosing a new request ID.', value);
  return value;
}

/** All mutating commands share the same durable request protocol.  Querying a
 * journaled request occurs before building a new transaction; manager.claim()
 * persists the digest before the network broadcast. */
export async function submitWrite(
  network: string,
  operation: string,
  options: WriteOptions,
  build: (auth: Authorization) => Promise<WritePlan>,
) {
  const auth = await authorize(network, 'operate');
  const stored = await loadKey(auth.profile.keyRef);
  if (!stored.key) throw new FmError(EXIT.not_authorized, 'not_authorized', 'The local Agent key is unavailable; run fm auth login again.');
  const signer = Ed25519Keypair.fromSecretKey(stored.key.signingSecret);
  const manager = new SelfPayTransactionManager({
    client: auth.sdk.client.client,
    network: auth.profile.network,
    signer,
    journal: new FileTransactionJournal(network),
  });
  const id = requestId(options.requestId, operation);
  try {
    const original = await manager.query(id);
    if (original) return resolved(original, { operation, idempotentRetry: true }, auth);
    const plan = await build(auth);
    const quote = await manager.prepare({ requestId: id, transaction: plan.transaction, gasBudget: GAS_BUDGET });
    const maximum = suiToMist(options.maxFee);
    if (BigInt(quote.estimatedGas) > maximum)
      throw new FmError(EXIT.fee_exceeds_limit, 'fee_exceeds_limit', `Quoted fee ${quote.estimatedGas} MIST exceeds --max-fee ${maximum} MIST.`, { quote, effect: plan.effect, trail: trail(auth) });
    if (options.dryRun) return { dry_run: true, digest: quote.digest, quote, effect: plan.effect, trail: trail(auth) };

    // A second authenticated RPC snapshot closes the ordinary prompt/quote
    // interval.  Move independently enforces OPERATE at execution time.
    await authorize(network, 'operate');
    const outcome = await manager.submit(quote);
    return resolved(outcome, plan.effect, auth);
  } catch (error) { return preflight(error); }
}

/** The current contract intentionally provides no Agent-authorized generic
 * approval-record writer.  Keep these attempts explicit rather than sending a
 * transaction that would require APPROVE or store an unreadable fake record. */
export function approvalRequired(input: {
  action: string;
  reason: string;
  title?: string;
  body?: string;
  ref?: string;
}): never {
  throw new FmError(
    EXIT.needs_approval,
    'needs_approval',
    input.reason,
    {
      approval: {
        status: 'not_filed',
        requestedBy: 'agent_operator_grant',
        action: input.action,
        ...(input.title ? { title: input.title } : {}),
        ...(input.body ? { body: input.body } : {}),
        ...(input.ref ? { ref: input.ref } : {}),
      },
      how_to_file: 'Ask a human with an APPROVE device grant to create and approve this request in the FractalMind App.',
    },
  );
}

export async function pauseRun(network: string, runId: string, options: WriteOptions) {
  return submitWrite(network, 'run-pause', options, async auth => {
    const run = await auth.sdk.nodeExecution.getExecution(runId);
    if (run.org_id !== auth.profile.organizationId)
      throw new FmError(EXIT.not_found, 'not_found', 'Run belongs to another organization.');
    if (![0, 1].includes(run.state) || run.stop_requested)
      throw new FmError(EXIT.conflict, 'conflict', 'Run is no longer pausable.');
    return {
      transaction: auth.sdk.nodeExecution.requestStop({
        executionId: run.id,
        capabilityId: run.capability_id,
        organizationId: auth.profile.organizationId,
        humanId: auth.profile.humanId,
        grantId: auth.grant.id,
      }),
      effect: { action: 'request_stop', runId: run.id, capabilityId: run.capability_id },
    };
  });
}

type AgentKeyring = { format: 1; contentKey: string; historicalKeys: Record<string, string> };
function isKeyring(value: unknown): value is AgentKeyring {
  return !!value && typeof value === 'object' && (value as Record<string, unknown>).format === 1
    && typeof (value as Record<string, unknown>).contentKey === 'string'
    && !!(value as Record<string, unknown>).historicalKeys
    && typeof (value as Record<string, unknown>).historicalKeys === 'object';
}

async function organizationKey(auth: Authorization, encryptionSecret: string) {
  if (!auth.grant.encrypted_keys.length) {
    approvalRequired({
      action: 'agent.message',
      reason: 'This Agent grant has no encrypted organization-key envelope. A human must share the organization key with this Agent before it can write an encrypted direct message.',
      title: 'Share Agent organization-key envelope',
      body: 'Use the App to distribute the current encrypted organization key to this Agent Operator grant.',
    });
  }
  let plain: Uint8Array | undefined;
  try {
    plain = await unwrapKeys(
      Uint8Array.from(auth.grant.encrypted_keys),
      fromBase64(encryptionSecret),
      `fractalmind.device-keys.v1:${auth.profile.network}:${auth.profile.address}`,
    );
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plain));
    if (!isKeyring(value)) throw new Error('invalid keyring');
    const key = hexToBytes(value.contentKey);
    if (key.length !== 32) throw new Error('invalid content key');
    return key;
  } catch (error) {
    if (error instanceof FmError) throw error;
    throw new FmError(EXIT.not_authorized, 'not_authorized', 'The Agent organization-key envelope is invalid or cannot be opened.');
  } finally { plain?.fill(0); }
}

async function managedAgent(auth: Authorization, target: string) {
  if (/^0x[0-9a-fA-F]+$/.test(target)) {
    const found = await auth.sdk.host.getManagedAgent(normalizeSuiAddress(target));
    if (found.org_id !== normalizeSuiAddress(auth.profile.organizationId)) throw new FmError(EXIT.not_found, 'not_found', 'Agent belongs to another organization.');
    return found;
  }
  let cursor: string | null = null, found: Awaited<ReturnType<typeof auth.sdk.host.getManagedAgent>>[] = [];
  do {
    const page = await auth.sdk.host.listManagedAgents(auth.profile.organizationId, cursor, 50);
    found = found.concat(page.agents.filter(agent => agent.instance_id === target));
    cursor = page.hasNextPage ? page.cursor : null;
  } while (cursor && found.length < 2);
  if (found.length !== 1) throw new FmError(EXIT.not_found, 'not_found', found.length ? 'Agent instance name is ambiguous.' : 'Agent instance was not found.');
  return found[0]!;
}

/** Write the same immutable encrypted `ask` record used by the App's direct
 * conversation flow.  This creates only the conversation message; executing
 * tools or widening a standing permission remains separately human-governed. */
export async function messageAgent(network: string, target: string, message: string, options: WriteOptions) {
  return submitWrite(network, 'agent-message', options, async auth => {
    const stored = await loadKey(auth.profile.keyRef);
    if (!stored.key) throw new FmError(EXIT.not_authorized, 'not_authorized', 'The local Agent key is unavailable; run fm auth login again.');
    const [managed, directory] = await Promise.all([
      managedAgent(auth, target),
      auth.sdk.productRecord.listCurrent(auth.profile.organizationId, null, 1),
    ]);
    const permission = await auth.sdk.directAgent.findPermissionForAgent(auth.profile.organizationId, managed.id);
    if (!permission || permission.revoked) {
      approvalRequired({
        action: 'agent.message',
        reason: 'The target Agent has no active human-created direct-message standing permission.',
        title: 'Configure direct conversation permission',
        body: 'Create a standing direct-message permission for the target Agent in the App, then retry.',
        ref: managed.id,
      });
    }
    const member = await auth.sdk.host.getMembership(managed.membership_id);
    // `CoordinatorBinding` is intentionally read from the membership’s exact
    // pointer, just as the App does; a substituted Host source cannot be used.
    const coordinator = await auth.sdk.host.getCoordinatorBinding(member.coordinator_binding);
    if (member.org_id !== normalizeSuiAddress(auth.profile.organizationId)
      || member.id !== permission.membership_id
      || member.coordinator_binding !== coordinator.id || managed.org_id !== member.org_id
      || managed.membership_id !== member.id || permission.managed_agent !== managed.id
      || permission.org_id !== member.org_id || permission.human_generation !== auth.human.generation
      || BigInt(permission.expires_at_ms) <= auth.now || BigInt(member.expires_at_ms) <= auth.now
      || member.revoked || coordinator.revoked || managed.revoked) {
      throw new FmError(EXIT.conflict, 'conflict', 'The target Agent, Host membership, or direct permission changed; refresh it before sending.');
    }
    const body = { schema: 'fractalmind.direct-request.v1', action: 'ask' as const, message, bounds: { paths: {}, max_calls: '0' } };
    const token = randomUUID(), logicalId = directMessageRecordName(token);
    const key = await organizationKey(auth, stored.key.encryptionSecret);
    let plaintext: Uint8Array | undefined;
    try {
      plaintext = new TextEncoder().encode(JSON.stringify(body));
      const encryptedBody = await encryptContent(plaintext, key, recordContext(auth.profile.organizationId, 'message', logicalId, 1, directory.keyVersion));
      const expiresAtMs = [
        auth.now + 300_000n,
        BigInt(Date.now() + 300_000),
        BigInt(permission.expires_at_ms),
        BigInt(member.expires_at_ms),
        BigInt(auth.grant.expires_at_ms),
      ].reduce((left, right) => left < right ? left : right);
      if (expiresAtMs <= auth.now || expiresAtMs <= BigInt(Date.now())) throw new FmError(EXIT.conflict, 'conflict', 'The direct-message permission expires too soon to send safely.');
      return {
        transaction: auth.sdk.directAgent.createMessage({
          organizationId: auth.profile.organizationId,
          humanId: auth.profile.humanId,
          grantId: auth.grant.id,
          membershipId: member.id,
          bindingId: coordinator.id,
          managedAgentId: managed.id,
          permissionId: permission.id,
          expectedVersion: permission.version,
          conversationId: managed.id.slice(2),
          messageToken: token,
          action: 'ask',
          paths: {},
          budgetAmount: 0n,
          requestHash: directRequestHash(body, 'ask'),
          expiresAtMs,
          keyVersion: directory.keyVersion,
          encryptedBody,
        }),
        effect: { action: 'direct_message', targetAgentId: managed.id, permissionId: permission.id, messageToken: token, messageRecord: logicalId },
      };
    } finally { plaintext?.fill(0); key.fill(0); }
  });
}
