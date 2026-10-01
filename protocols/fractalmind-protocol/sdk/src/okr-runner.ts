import type { Transaction } from '@mysten/sui/transactions';
import { normalizeSuiAddress } from '@mysten/sui/utils';
import type { FractalMindSDK } from './index.js';
import type { NodeCommandSigner, SignedNodeCommand } from './types.js';
import { bytesToHex, encryptContent } from './identity-crypto.js';
import { recordContext } from './product-record.js';
import { executionBoundaryHash } from './execution-boundary.js';
import { signNodeCommand } from './node-command.js';
import { nodeCommandIntentHash, verifySignedNodeCommand } from './node-execution.js';

export type NativeFileKrPlan = { files: Array<{ path: string; content: string }>; maxCalls: string };
export type NativeFileOkrPlan = { format: 1; paths: Record<string, string[]>; krs: NativeFileKrPlan[] };
export type OkrRunnerSubmission = { status: 'confirmed' | 'rejected' | 'unknown'; digest?: string; reason?: string };
export type OkrRunnerSubmissionContext = { requestId: string };
export type OkrRunnerState = {
  status: 'idle' | 'paused' | 'awaiting_approval' | 'queued' | 'running' | 'awaiting_confirmation' | 'awaiting_verification' | 'awaiting_acceptance' | 'achieved' | 'blocked';
  reason?: string; okrId: string; krIndex?: string; executionId?: string; ticketRecordId?: string; transactionDigest?: string;
};
export type OkrRunnerOptions = {
  sdk: FractalMindSDK; organizationId: string; humanId: string; grantId: string;
  signer: NodeCommandSigner;
  /** Return an authorized current/historical organization key. Runner copies it. */
  keyForVersion(version: string): Promise<Uint8Array>;
  /** Uses the application's transaction manager; no internal blind retry. */
  submit(transaction: Transaction, context: OkrRunnerSubmissionContext): Promise<OkrRunnerSubmission>;
  /** Fixed-instance signed delivery; an unavailable Host must not be rerouted. */
  deliver(command: SignedNodeCommand): Promise<void>;
  now?: () => number;
};
type Okr = Awaited<ReturnType<FractalMindSDK['okr']['getOkr']>>;
type Ticket = { schema: 'fractalmind.okr-command-ticket.v1'; okrId: string; specRecordId: string; agreementRecordId: string; command: SignedNodeCommand };
type Directory = { keyVersion: string; ticketId?: string };

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a plan object.');
  return value as Record<string, unknown>;
}
function portablePath(name: string, directory = false): boolean {
  const encoded = new TextEncoder().encode(name);
  if (!encoded.length || encoded.length > 1024 || new TextDecoder().decode(encoded) !== name || /[\\:\x00]/.test(name)) return false;
  if (directory && name === '.') return true;
  return name.split('/').every(part => part && part !== '.' && part !== '..'
    && !/^\.(git|claude|codex|agents)$/i.test(part) && !/^\.fractalmind-write-/i.test(part)
    && !/[. ]$|~/.test(part) && !/^(CON|PRN|AUX|NUL|CONIN\$|CONOUT\$|COM[1-9¹²³]|LPT[1-9¹²³])(?:\.|$)/i.test(part));
}
/** One explicit native profile; arbitrary task text is not silently interpreted
 * as a safe goal. Other Agent planners require their own bounded profile. */
export function parseNativeFileOkrPlan(value: unknown): NativeFileOkrPlan {
  const plan = object(value);
  if (plan.format !== 1 || Object.keys(plan).some(key => !['format', 'paths', 'krs'].includes(key)) || !Array.isArray(plan.krs) || plan.krs.length < 1 || plan.krs.length > 3) throw new Error('Invalid native OKR plan.');
  const paths = object(plan.paths) as Record<string, string[]>;
  executionBoundaryHash(paths);
  if (Object.values(paths).some(directories => directories.some(directory => !portablePath(directory, true)))) throw new Error('Invalid native boundary directory.');
  const krs = plan.krs.map(input => {
    const kr = object(input);
    if (Object.keys(kr).some(key => !['files', 'maxCalls'].includes(key)) || typeof kr.maxCalls !== 'string' || !/^[1-9][0-9]*$/.test(kr.maxCalls) || BigInt(kr.maxCalls) > 1000n || !Array.isArray(kr.files) || kr.files.length < 1 || kr.files.length > 3) throw new Error('Invalid native KR plan.');
    const files = kr.files.map(input => {
      const file = object(input);
      if (Object.keys(file).some(key => !['path', 'content'].includes(key)) || typeof file.path !== 'string' || typeof file.content !== 'string' || !portablePath(file.path)) throw new Error('Invalid native file goal.');
      const content = new TextEncoder().encode(file.content);
      if (content.length > 16384 || new TextDecoder().decode(content) !== file.content) throw new Error('Invalid native file text.');
      return { path: file.path, content: file.content };
    });
    if (new Set(files.map(file => file.path)).size !== files.length || new TextEncoder().encode(JSON.stringify({ kind: 'ensure_text_files', files })).length > 16384) throw new Error('Duplicate files or oversized native task.');
    return { files, maxCalls: kr.maxCalls };
  });
  return { format: 1, paths: Object.fromEntries(Object.entries(paths).map(([action, dirs]) => [action, [...dirs]])), krs };
}

export function okrRunnerTicketName(okrId: string, agreement: string, kr: string) {
  return `runner-${normalizeSuiAddress(okrId).slice(2)}-${agreement}-${kr}`;
}

/** Device-local advancement. Durable tickets, reservations, results and
 * observations live on Sui. Does not verify KRs or accept on a human's behalf.
 * Fresh runners restore/query by default; enabling a new ticket or releasing
 * a recovered queued ticket is an explicit caller action. */
export class NativeFileOkrRunner {
  private readonly flights = new Map<string, Promise<OkrRunnerState>>();
  private readonly unknownSubmissions = new Map<string, { digest?: string; confirmed?: boolean }>();
  constructor(private readonly options: OkrRunnerOptions) {}

  step(input: { okrId: string; capabilityId: string; createIfMissing?: boolean; releaseQueued?: boolean }): Promise<OkrRunnerState> {
    const key = normalizeSuiAddress(input.okrId);
    const running = this.flights.get(key); if (running) return running;
    const flight = this.advance({ ...input, okrId: key }).finally(() => this.flights.delete(key));
    this.flights.set(key, flight); return flight;
  }
  private async directory(logicalId: string): Promise<Directory> {
    let cursor: string | null = null, keyVersion: string | undefined, ticketId: string | undefined;
    do {
      const page = await this.options.sdk.productRecord.listCurrent(this.options.organizationId, cursor, 100);
      if (keyVersion && keyVersion !== page.keyVersion) throw new Error('Record key generation changed during runner discovery.');
      keyVersion = page.keyVersion;
      for (const row of page.records) if (row.kind === 5 && row.logicalId === logicalId) {
        if (ticketId) throw new Error('Duplicate runner ticket index.'); ticketId = row.record_id;
      }
      cursor = page.cursor;
    } while (cursor);
    if (!keyVersion) throw new Error('Missing organization record index.');
    return { keyVersion, ticketId };
  }
  /** Index reads can lag confirmed execution effects. Wait only for matching
   * chain facts; this never retries a transaction or a Host delivery. */
  private async confirmRead<T>(read: () => Promise<T>, present: (value: T) => boolean): Promise<T> {
    const deadline = Date.now() + 5000;
    let value = await read();
    while (!present(value) && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 50));
      value = await read();
    }
    return value;
  }
  private async decrypt(recordId: string) {
    const api = this.options.sdk.productRecord, metadata = await api.getRecord(recordId);
    if (metadata.organization_id !== normalizeSuiAddress(this.options.organizationId)) throw new Error('Cross-organization runner record.');
    const key = new Uint8Array(await this.options.keyForVersion(metadata.key_version));
    try { return await api.decryptRecord(recordId, key); } finally { key.fill(0); }
  }
  private async plan(okr: Okr) {
    if (!okr.agreement_record) throw new Error('Missing approved execution agreement.');
    const { record, plaintext } = await this.decrypt(okr.agreement_record);
    try {
      if (record.kind !== 2 || record.logical_id !== `okr-${okr.logical_id}-agreement`) throw new Error('Unexpected execution agreement provenance.');
      const plan = parseNativeFileOkrPlan(object(JSON.parse(new TextDecoder().decode(plaintext))).nativeFilePlan);
      if (plan.krs.length !== okr.metrics.length || bytesToHex(executionBoundaryHash(plan.paths)) !== bytesToHex(Uint8Array.from(okr.boundary_hash)) || okr.budget_asset !== 'TOOL_CALLS') throw new Error('Plan differs from approved boundaries or metrics.');
      plan.krs.forEach((kr, index) => { if (okr.metrics[index].baseline !== '0' || okr.metrics[index].target !== String(kr.files.length)) throw new Error('Native plan must measure each declared file count.'); });
      return plan;
    } finally { plaintext.fill(0); }
  }
  private async ticket(recordId: string, name: string, okr: Okr, plan: NativeFileOkrPlan): Promise<Ticket> {
    const { record, plaintext } = await this.decrypt(recordId);
    try {
      if (record.kind !== 5 || record.logical_id !== name || record.revision !== '1') throw new Error('Unexpected runner ticket provenance.');
      const ticket = JSON.parse(new TextDecoder().decode(plaintext)) as Ticket;
      if (ticket.schema !== 'fractalmind.okr-command-ticket.v1' || ticket.okrId !== okr.id || ticket.specRecordId !== okr.spec_record || ticket.agreementRecordId !== okr.agreement_record) throw new Error('Runner ticket agreement mismatch.');
      await verifySignedNodeCommand(ticket.command);
      const kr = plan.krs[Number(okr.next_kr)], command = ticket.command;
      const context = command.payload.okr as { id: string; agreement_version: string; kr_index: string };
      if (command.action !== 'assign' || command.scope !== 'control' || command.target.organization_id !== okr.org_id || command.budget?.asset !== 'TOOL_CALLS' || command.budget.amount !== kr.maxCalls || context?.id !== okr.id || context.agreement_version !== okr.agreement_version || context.kr_index !== okr.next_kr || command.payload.task !== JSON.stringify({ kind: 'ensure_text_files', files: kr.files }) || JSON.stringify(command.payload.bounds) !== JSON.stringify({ paths: plan.paths, max_calls: kr.maxCalls }) || JSON.stringify(command.payload.measurement) !== JSON.stringify({ kind: 'verified_text_file_count' })) throw new Error('Runner ticket differs from the approved plan.');
      return ticket;
    } finally { plaintext.fill(0); }
  }
  private async executions(okrId: string) {
    const executions = []; let cursor: string | null = null;
    do { const page = await this.options.sdk.okr.listExecutions(okrId, cursor, 100); executions.push(...page.executions); cursor = page.cursor; } while (cursor);
    return executions;
  }
  private lifecycle(okr: Okr): OkrRunnerState | undefined {
    const base = { okrId: okr.id, krIndex: okr.next_kr };
    if (okr.state === 3) return { ...base, status: 'achieved' };
    if (okr.state !== 1) return { ...base, status: 'paused', reason: 'objective_not_active' };
    if (BigInt(okr.expires_at_ms) <= BigInt((this.options.now ?? Date.now)())) return { ...base, status: 'paused', reason: 'agreement_expired' };
    if (Number(okr.next_kr) === okr.metrics.length) return { ...base, status: 'awaiting_acceptance' };
    const metric = okr.metrics[Number(okr.next_kr)];
    if (metric.current !== null && metric.run_id && metric.evidence_id) {
      const now = BigInt((this.options.now ?? Date.now)());
      const sampled = BigInt(metric.sampled_at_ms);
      const fresh = sampled <= now && now - sampled <= BigInt(metric.max_age_ms);
      return { ...base, status: 'awaiting_verification', executionId: metric.run_id,
        ...(!fresh ? { reason: 'measurement_stale_or_future' } : BigInt(metric.current) < BigInt(metric.target) ? { reason: 'measurement_below_target' } : {}) };
    }
    return undefined;
  }
  private async advance(input: { okrId: string; capabilityId: string; createIfMissing?: boolean; releaseQueued?: boolean }): Promise<OkrRunnerState> {
    const { sdk } = this.options;
    const okr = await sdk.okr.getOkr(input.okrId);
    if (okr.org_id !== normalizeSuiAddress(this.options.organizationId)) throw new Error('Runner organization mismatch.');
    const lifecycle = this.lifecycle(okr); if (lifecycle) return lifecycle;
    const base = { okrId: okr.id, krIndex: okr.next_kr };
    const plan = await this.plan(okr), name = okrRunnerTicketName(okr.id, okr.agreement_version, okr.next_kr);
    let directory = await this.directory(name), newFingerprint: string | undefined, submission: OkrRunnerSubmission | undefined;
    if (!directory.ticketId) {
      const unknown = this.unknownSubmissions.get(name);
      if (unknown) return { ...base, status: 'awaiting_confirmation', reason: unknown.confirmed ? 'ticket_index_not_visible' : 'ticket_transaction_unknown', transactionDigest: unknown.digest };
      if (!input.createIfMissing) return { ...base, status: 'idle', reason: 'no_confirmed_ticket' };
      if (!okr.managed_agent || !okr.membership_id) throw new Error('Active OKR has no managed assignment.');
      const [managed, member, capability, binding, contract, budget] = await Promise.all([
        sdk.host.getManagedAgent(okr.managed_agent), sdk.host.getMembership(okr.membership_id), sdk.remoteAuthority.getCapability(input.capabilityId), sdk.host.getAuthorityBinding(input.capabilityId), sdk.okr.getCapabilityContract(input.capabilityId), sdk.okr.getBudget(okr.id),
      ]);
      const signer = this.options.signer.getPublicKey().toSuiAddress(), now = (this.options.now ?? Date.now)(), kr = plan.krs[Number(okr.next_kr)];
      const assignmentMatches = managed.org_id === okr.org_id && managed.id === okr.managed_agent
        && managed.membership_id === okr.membership_id && managed.version === okr.managed_version
        && member.id === okr.membership_id && member.org_id === okr.org_id && member.version === okr.membership_version
        && !managed.revoked && managed.control_confirmed && !member.revoked;
      const capabilityMatches = capability.type === `${sdk.client.typesPackageId}::remote_authority::RemoteCapability`
        && capability.delegate === signer && !capability.revoked && capability.orgId === okr.org_id
        && capability.agentId === managed.instance_id && capability.nodeId === member.host_address
        && capability.scope === 'control' && capability.actions.length === 1 && capability.actions[0] === 'assign';
      const contractMatches = contract.contract_id === okr.id && contract.agreement_version === okr.agreement_version
        && bytesToHex(Uint8Array.from(contract.boundary_hash)) === bytesToHex(Uint8Array.from(okr.boundary_hash));
      const deviceMatches = binding.human_id === normalizeSuiAddress(this.options.humanId)
        && binding.device_grant === normalizeSuiAddress(this.options.grantId);
      if (!assignmentMatches || !capabilityMatches || !contractMatches || !deviceMatches) return { ...base, status: 'awaiting_approval', reason: 'current_device_or_assignment_authority_changed' };
      if (capability.usesClaimed + capability.usesDelegated >= capability.maxUses) return { ...base, status: 'awaiting_approval', reason: 'capability_uses_exhausted' };
      if (binding.membership_id !== member.id || binding.membership_version !== member.version || binding.managed_agent !== managed.id || binding.managed_agent_version !== managed.version || managed.host_address !== member.host_address || bytesToHex(Uint8Array.from(managed.workspace_hash)) !== bytesToHex(Uint8Array.from(okr.workspace_hash)) || capability.budgetAsset !== 'TOOL_CALLS') return { ...base, status: 'awaiting_approval', reason: 'current_assignment_binding_changed' };
      if (capability.budgetClaimed + capability.budgetDelegated + BigInt(kr.maxCalls) > capability.maxBudget) return { ...base, status: 'awaiting_approval', reason: 'capability_budget_exhausted' };
      if (budget.spent + budget.reserved + BigInt(kr.maxCalls) > BigInt(okr.budget_limit)) return { ...base, status: 'awaiting_approval', reason: 'budget_exhausted_including_reservations' };
      const expires = [BigInt(now + 300000), capability.expiresAtMs, BigInt(okr.expires_at_ms), BigInt(member.expires_at_ms)].reduce((a, b) => a < b ? a : b);
      if (expires <= BigInt(now)) return { ...base, status: 'awaiting_approval', reason: 'execution_authority_expired' };
      const command = await signNodeCommand(this.options.signer, { target: { organizationId: okr.org_id, nodeId: member.host_address, agentId: managed.instance_id }, action: 'assign', scope: 'control', capability: { id: capability.objectId, revocationVersion: capability.revocationVersion }, budget: { asset: 'TOOL_CALLS', amount: BigInt(kr.maxCalls) }, issuedAtMs: now, expiresAtMs: Number(expires), payload: { okr: { id: okr.id, agreement_version: okr.agreement_version, kr_index: okr.next_kr }, measurement: { kind: 'verified_text_file_count' }, bounds: { paths: plan.paths, max_calls: kr.maxCalls }, task: JSON.stringify({ kind: 'ensure_text_files', files: kr.files }) } });
      const latest = await sdk.okr.getOkr(okr.id);
      if (latest.state !== 1 || latest.version !== okr.version || latest.agreement_version !== okr.agreement_version || latest.agreement_record !== okr.agreement_record || latest.next_kr !== okr.next_kr) return { ...base, status: 'paused', reason: 'agreement_changed_during_planning' };
      const key = new Uint8Array(await this.options.keyForVersion(directory.keyVersion));
      try {
        const ticket: Ticket = { schema: 'fractalmind.okr-command-ticket.v1', okrId: okr.id, specRecordId: okr.spec_record, agreementRecordId: okr.agreement_record!, command };
        const plaintext = new TextEncoder().encode(JSON.stringify(ticket));
        let ciphertext: Uint8Array;
        try { ciphertext = await encryptContent(plaintext, key, recordContext(okr.org_id, 'checkpoint', name, 1n, directory.keyVersion)); } finally { plaintext.fill(0); }
        const tx = sdk.productRecord.save({ organizationId: okr.org_id, humanId: this.options.humanId, grantId: this.options.grantId, kind: 'checkpoint', logicalId: name, expectedRevision: 0n, keyVersion: directory.keyVersion, encryptedBody: ciphertext });
        await sdk.nodeExecution.prepareCommand({ humanId: this.options.humanId, grantId: this.options.grantId, membershipId: member.id, bindingId: member.coordinator_binding, managedAgentId: managed.id, command, resultKey: { organizationKey: key, keyVersion: directory.keyVersion }, tx });
        newFingerprint = bytesToHex(nodeCommandIntentHash(command));
        this.unknownSubmissions.set(name, {});
        try { submission = await this.options.submit(tx, { requestId: name }); } catch { submission = { status: 'unknown' }; }
        this.unknownSubmissions.set(name, { digest: submission.digest, confirmed: submission.status === 'confirmed' });
        if (submission.status === 'rejected') this.unknownSubmissions.delete(name);
        directory = submission.status === 'confirmed'
          ? await this.confirmRead(() => this.directory(name), value => Boolean(value.ticketId))
          : await this.directory(name);
        if (!directory.ticketId) {
          if (submission.status === 'rejected') { this.unknownSubmissions.delete(name); return { ...base, status: 'blocked', reason: submission.reason ?? 'ticket_transaction_rejected', transactionDigest: submission.digest }; }
          return { ...base, status: 'awaiting_confirmation', reason: submission.status === 'confirmed' ? 'ticket_index_not_visible' : submission.reason ?? 'ticket_transaction_unknown', transactionDigest: submission.digest };
        }
      } finally { key.fill(0); }
    }
    const ticket = await this.ticket(directory.ticketId!, name, okr, plan), fingerprint = bytesToHex(nodeCommandIntentHash(ticket.command));
    const readRun = async () => (await this.executions(okr.id)).find(row => bytesToHex(Uint8Array.from(row.run.intent_hash)) === fingerprint && row.run.capability_id === ticket.command.capability.id)?.run;
    const run = newFingerprint ? await this.confirmRead(readRun, value => Boolean(value)) : await readRun();
    const detail = { ...base, ticketRecordId: directory.ticketId, transactionDigest: submission?.digest };
    if (!run) return { ...detail, status: 'awaiting_confirmation', reason: 'prepared_run_not_visible' };
    this.unknownSubmissions.delete(name);
    if (run.command_id !== ticket.command.command_id || run.delegate !== ticket.command.signer || run.node_id !== ticket.command.target.node_id || run.agent_id !== ticket.command.target.agent_id || run.budget_amount !== ticket.command.budget?.amount || run.org_id !== okr.org_id || run.action !== ticket.command.action || run.scope !== ticket.command.scope || run.nonce !== ticket.command.nonce || run.idempotency_key !== ticket.command.idempotency_key || run.budget_asset !== ticket.command.budget?.asset || run.issued_at_ms !== String(ticket.command.issued_at_ms) || run.expires_at_ms !== String(ticket.command.expires_at_ms)) throw new Error('Run differs from the persisted signed ticket.');
    const withRun = { ...detail, executionId: run.id };
    if (run.state === 4) return { ...withRun, status: 'awaiting_confirmation', reason: 'execution_outcome_unknown' };
    if (run.state === 1) return { ...withRun, status: 'running' };
    if (run.state === 3 || run.state === 5) return { ...withRun, status: 'blocked', reason: 'execution_failed_or_cancelled' };
    if (run.state === 2) return { ...withRun, status: 'awaiting_confirmation', reason: 'measurement_not_confirmed' };
    if (ticket.command.expires_at_ms <= (this.options.now ?? Date.now)()) return { ...withRun, status: 'blocked', reason: 'prepared_command_expired' };
    if (fingerprint !== newFingerprint && !input.releaseQueued) return { ...withRun, status: 'queued', reason: 'restored_ticket_requires_delivery_release' };
    const current = await sdk.okr.getOkr(okr.id);
    if (current.version !== okr.version || current.state !== 1 || current.agreement_version !== okr.agreement_version || current.next_kr !== okr.next_kr) return { ...withRun, status: 'paused', reason: 'agreement_changed_before_delivery' };
    try { await this.options.deliver(ticket.command); } catch { return { ...withRun, status: 'awaiting_confirmation', reason: 'delivery_outcome_unknown' }; }
    const observed = await sdk.okr.getOkr(okr.id);
    const updated = this.lifecycle(observed);
    return updated ? { ...withRun, ...updated } : { ...withRun, status: 'running', reason: 'awaiting_chain_execution_progress' };
  }
}
