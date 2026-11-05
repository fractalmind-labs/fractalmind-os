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

export async function organizationKey(auth: Authorization, encryptionSecret: string) {
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

type AgentDraft = {
  logicalId: string;
  priority: number;
  deadlineMs: string;
  baselines: string[];
  targets: string[];
  weights: string[];
  maxAgesMs: string[];
  plaintext: Record<string, unknown>;
};

function uint(value: unknown, noun: string, minimum = 0n, maximum = 18446744073709551615n) {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value))
    throw new FmError(EXIT.usage, 'usage', `${noun} must be an unsigned integer string.`);
  const parsed = BigInt(value);
  if (parsed < minimum || parsed > maximum)
    throw new FmError(EXIT.usage, 'usage', `${noun} is out of range.`);
  return value;
}

/** The chain deliberately stores only the measurable parts of a draft in the
 * clear. Everything else in the input JSON is encrypted as its spec. */
export function agentDraft(input: Record<string, unknown>, fallbackLogicalId: string): AgentDraft {
  const logicalId = input.logicalId === undefined ? fallbackLogicalId : input.logicalId;
  if (typeof logicalId !== 'string' || !logicalId || new TextEncoder().encode(logicalId).length > 64)
    throw new FmError(EXIT.usage, 'usage', 'draft.logicalId must be a non-empty UTF-8 string up to 64 bytes.');
  if (!Number.isInteger(input.priority) || (input.priority as number) < 0 || (input.priority as number) > 2)
    throw new FmError(EXIT.usage, 'usage', 'draft.priority must be 0, 1, or 2.');
  const deadlineMs = uint(input.deadlineMs, 'draft.deadlineMs', 1n);
  if (!Array.isArray(input.krs) || input.krs.length < 1 || input.krs.length > 3)
    throw new FmError(EXIT.usage, 'usage', 'draft.krs must contain one to three KRs.');
  const rows = input.krs.map((row, index) => {
    if (!row || typeof row !== 'object' || Array.isArray(row))
      throw new FmError(EXIT.usage, 'usage', `draft.krs[${index}] must be an object.`);
    const value = row as Record<string, unknown>;
    const baseline = uint(value.baseline, `draft.krs[${index}].baseline`);
    const target = uint(value.target, `draft.krs[${index}].target`);
    const weight = uint(value.weight, `draft.krs[${index}].weight`, 1n, 1000000n);
    const maxAgeMs = uint(value.maxAgeMs, `draft.krs[${index}].maxAgeMs`, 1n, 2592000000n);
    if (baseline === target) throw new FmError(EXIT.usage, 'usage', `draft.krs[${index}] baseline and target must differ.`);
    return { baseline, target, weight, maxAgeMs };
  });
  return {
    logicalId,
    priority: input.priority as number,
    deadlineMs,
    baselines: rows.map(row => row.baseline), targets: rows.map(row => row.target),
    weights: rows.map(row => row.weight), maxAgesMs: rows.map(row => row.maxAgeMs),
    plaintext: { ...input, logicalId },
  };
}

async function keyVersion(auth: Authorization) {
  try { return (await auth.sdk.productRecord.listCurrent(auth.profile.organizationId, null, 1)).keyVersion; }
  catch (error) {
    if (error && typeof error === 'object' && 'reason' in error && error.reason === 'notFound') return '1';
    throw error;
  }
}

async function storedOrganizationKey(auth: Authorization) {
  const stored = await loadKey(auth.profile.keyRef);
  if (!stored.key) throw new FmError(EXIT.not_authorized, 'not_authorized', 'The local Agent key is unavailable; run fm auth login again.');
  return organizationKey(auth, stored.key.encryptionSecret);
}

/** Decrypt through the Agent's own grant envelope. Callers never receive the
 * organization key, and it is zeroed as soon as the SDK has authenticated the
 * record's context. */
export async function decryptAgentRecord(auth: Authorization, recordId: string) {
  const key = await storedOrganizationKey(auth);
  try {
    const { record, plaintext } = await auth.sdk.productRecord.decryptRecord(recordId, key);
    try { return { record, value: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plaintext)) as unknown }; }
    finally { plaintext.fill(0); }
  } catch (error) {
    if (error instanceof FmError) throw error;
    throw new FmError(EXIT.conflict, 'conflict', 'Encrypted organization record could not be decrypted with this Agent grant.');
  } finally { key.fill(0); }
}

/** Creates only an immutable DRAFT through the Agent-only Move entry point.
 * A conflicting logical ID is intentionally left to the chain's fingerprint
 * check; an Agent must never silently replace someone else's proposal. */
export async function createOkrDraft(network: string, input: Record<string, unknown>, options: WriteOptions, forcedLogicalId?: string) {
  const fallback = forcedLogicalId ?? `agent-${randomUUID()}`;
  const draft = agentDraft(input, fallback);
  return submitWrite(network, 'okr-draft-create', options, async auth => {
    const key = await storedOrganizationKey(auth);
    let plaintext: Uint8Array | undefined;
    try {
      const version = await keyVersion(auth);
      if (BigInt(draft.deadlineMs) <= auth.now)
        throw new FmError(EXIT.conflict, 'conflict', 'Draft deadline has already passed.');
      plaintext = new TextEncoder().encode(JSON.stringify(draft.plaintext));
      if (plaintext.length > 65504) throw new FmError(EXIT.usage, 'usage', 'Draft plaintext exceeds the encrypted record capacity.');
      const encryptedBody = await encryptContent(plaintext, key, recordContext(auth.profile.organizationId, 'okr', `okr-${draft.logicalId}-spec`, 1, version));
      return {
        transaction: auth.sdk.okr.createDraftByAgent({
          organizationId: auth.profile.organizationId, humanId: auth.profile.humanId, grantId: auth.grant.id,
          logicalId: draft.logicalId, priority: draft.priority, deadlineMs: draft.deadlineMs,
          baselines: draft.baselines, targets: draft.targets, weights: draft.weights, maxAgesMs: draft.maxAgesMs,
          keyVersion: version, encryptedBody,
        }),
        effect: { action: 'create_okr_draft', logicalId: draft.logicalId, state: 'draft_only' },
      };
    } finally { plaintext?.fill(0); key.fill(0); }
  });
}

/** Draft objects are immutable proposals. The Agent-only contract has no
 * replacement writer, so "update" reuses the draft's logical ID and lets the
 * on-chain fingerprint guard reject any changed proposal rather than silently
 * mutating it. A human APPROVE device remains responsible for replacements. */
export async function updateOkrDraft(network: string, okrId: string, input: Record<string, unknown>, options: WriteOptions) {
  const auth = await authorize(network, 'operate');
  const okr = await auth.sdk.okr.getOkr(okrId);
  if (okr.org_id !== normalizeSuiAddress(auth.profile.organizationId))
    throw new FmError(EXIT.not_found, 'not_found', 'OKR belongs to another organization.');
  if (okr.state !== 0)
    throw new FmError(EXIT.conflict, 'conflict', 'Only DRAFT OKRs can be proposed again.');
  return createOkrDraft(network, { ...input, logicalId: okr.logical_id }, options, okr.logical_id);
}

/** File a constrained encrypted approval request.  It is explicitly not an
 * approval decision and its reserved namespace is enforced again on chain. */
export async function requestApproval(network: string, kind: string, title: string, body: string, ref: string | undefined, options: WriteOptions) {
  const logicalId = `agent-request:${kind}:${randomUUID()}`;
  return submitWrite(network, 'approval-request', options, async auth => {
    const key = await storedOrganizationKey(auth);
    let plaintext: Uint8Array | undefined;
    try {
      const version = await keyVersion(auth);
      plaintext = new TextEncoder().encode(JSON.stringify({ schema: 'fractalmind.agent-approval-request.v1', kind, title, body, ...(ref ? { ref } : {}), status: 'pending' }));
      if (plaintext.length > 65504) throw new FmError(EXIT.usage, 'usage', 'Approval request plaintext exceeds the encrypted record capacity.');
      const encryptedBody = await encryptContent(plaintext, key, recordContext(auth.profile.organizationId, 'approval', logicalId, 1, version));
      return {
        transaction: auth.sdk.productRecord.saveAgentRequest({
          organizationId: auth.profile.organizationId, humanId: auth.profile.humanId, grantId: auth.grant.id,
          logicalId, expectedRevision: 0, keyVersion: version, encryptedBody,
        }),
        effect: { action: 'file_approval_request', kind, logicalId, status: 'pending' },
      };
    } finally { plaintext?.fill(0); key.fill(0); }
  });
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
