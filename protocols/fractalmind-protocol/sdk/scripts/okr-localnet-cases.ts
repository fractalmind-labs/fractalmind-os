import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { FractalMindSDK, encryptContent, recordContext, metricProgress, signNodeCommand } from '../src/index.js';
import type { ProductRecordKind } from '../src/index.js';
import type { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import type { Transaction } from '@mysten/sui/transactions';
import type { SuiClientTypes } from '@mysten/sui/client';
type Data = SuiClientTypes.Transaction<{ effects: true; objectTypes: true; events: true }>;
type Execute = (label: string, tx: Transaction, signer?: Ed25519Keypair, sponsor?: Ed25519Keypair, allowRejected?: boolean) => Promise<{ data: Data }>;
type Options = { sdk: FractalMindSDK; execute: Execute; created: (data: Data, suffix: string) => string; organizationId: string; humanId: string; grantId: string; membershipId: string; bindingId: string; managedAgentId: string; desktop: Ed25519Keypair; host: Ed25519Keypair; wrongHost: Ed25519Keypair; contentKey: Uint8Array };

/** Real OKR-bound file execution; no mock budget or runtime authority. */
export async function prepareOkrAcceptance(o: Options, boundaryHash: Uint8Array) {
  const { sdk, execute, created } = o;
  const authorized = { organizationId: o.organizationId, humanId: o.humanId, grantId: o.grantId };
  const criteria = { priority: 0, deadlineMs: Date.now() + 3600000, baselines: [0n, 0n], targets: [2n, 1n], weights: [1n, 1n], maxAgesMs: [3600000n, 3600000n] };
  const originals = new Map<string, string>();
  async function body(logicalId: string, suffix: string, kind: ProductRecordKind, revision: bigint, plaintext: string) {
    const name = `okr-${logicalId}-${suffix}`;
    originals.set(name, plaintext);
    return { keyVersion: 1n, encryptedBody: await encryptContent(new TextEncoder().encode(plaintext), o.contentKey, recordContext(o.organizationId, kind, name, revision, 1n)) };
  }
  const drafts: Array<{ id: string; logicalId: string; spec: Awaited<ReturnType<typeof body>> }> = [];
  for (let i = 0; i < 4; i++) {
    const logicalId = randomUUID();
    const spec = await body(logicalId, 'spec', 'okr', 1n, JSON.stringify({ format: 1, objective: 'Two sequential KRs produce measured file outcomes and human acceptance', successCriteria: ['KR0: both initial text goals match', 'KR1: a final deliverable matches'], metrics: [{ unit: 'verified files', scale: 1, baseline: 0, target: 2, source: 'Host post-write reader', freshnessMs: 3600000 }, { unit: 'verified files', scale: 1, baseline: 0, target: 1, source: 'Host post-write reader', freshnessMs: 3600000 }] }));
    const made = await execute('OKR: create encrypted measurable draft', sdk.okr.createDraft({ ...authorized, ...criteria, ...spec, logicalId }));
    assert.equal(made.data.status.success, true);
    drafts.push({ id: created(made.data, '::okr::Okr'), logicalId, spec });
  }
  const first = drafts[0];
  const exactRetry = await execute('OKR: exact draft retry preserves original object', sdk.okr.createDraft({ ...authorized, ...criteria, ...first.spec, logicalId: first.logicalId }));
  assert.equal(exactRetry.data.status.success, true);
  assert.equal(Object.values(exactRetry.data.objectTypes ?? {}).filter(type => type.endsWith('::okr::Okr')).length, 0);
  const managed = await sdk.host.getManagedAgent(o.managedAgentId);
  async function activate(draft: typeof first, allowed = true) {
    const agreement = await body(draft.logicalId, 'agreement', 'contract', 1n, JSON.stringify({ format: 1, managedAgentId: o.managedAgentId, boundaryHash: Array.from(boundaryHash), budget: { asset: 'TOOL_CALLS', limit: '14' }, order: 'sequential', verifier: 'authorized human' }));
    const made = await execute(allowed ? 'OKR: activate one explicitly managed Agent' : 'OKR: fourth ACTIVE is rejected atomically', sdk.okr.activate({ ...authorized, ...agreement, okrId: draft.id, expectedVersion: 1n, membershipId: o.membershipId, bindingId: o.bindingId, managedAgentId: o.managedAgentId, workspaceHash: Uint8Array.from(managed.workspace_hash), boundaryHash, budgetAsset: 'TOOL_CALLS', budgetLimit: 14n, expiresAtMs: Date.now() + 300000, expectedRecordRevision: 0n }), o.desktop, undefined, !allowed);
    assert.equal(made.data.status.success, allowed);
    if (!allowed) assert.match(JSON.stringify(made.data.status), /9404/);
  }
  for (const draft of drafts.slice(0, 3)) await activate(draft);
  await activate(drafts[3], false);
  assert.equal((await sdk.okr.getIndex(o.organizationId)).active_count, '3');
  assert.equal((await sdk.okr.getOkr(drafts[3].id)).state, 0);
  // A prepared command loses start authority when its OKR pauses, while the
  // device may still cancel that old reservation using its historical binding.
  const pausedCap = await execute('OKR binding: issue capability for pause boundary', sdk.okr.issueCapability({ ...authorized, okrId: drafts[1].id, membershipId: o.membershipId, bindingId: o.bindingId, managedAgentId: o.managedAgentId, expectedVersion: 2n, maxUses: 1n }));
  assert.equal(pausedCap.data.status.success, true);
  const pausedCapabilityId = created(pausedCap.data, '::remote_authority::RemoteCapability');
  const pausedCommand = await signNodeCommand(o.desktop, { target: { organizationId: o.organizationId, nodeId: o.host.getPublicKey().toSuiAddress(), agentId: managed.instance_id }, action: 'assign', scope: 'control', capability: { id: pausedCapabilityId, revocationVersion: 1n }, budget: { asset: 'TOOL_CALLS', amount: 2n }, payload: { okr: { id: drafts[1].id, agreement_version: '1', kr_index: '0' }, bounds: { paths: { 'file.read': ['.'], 'file.write': ['.'] }, max_calls: '2' }, task: 'prepared only; no physical Agent execution' }, expiresAtMs: Number((await sdk.okr.getOkr(drafts[1].id)).expires_at_ms) - 1 });
  const pausedPrepared = await execute('OKR binding: prepare command before pause', await sdk.nodeExecution.prepareCommand({ ...authorized, membershipId: o.membershipId, bindingId: o.bindingId, managedAgentId: o.managedAgentId, command: pausedCommand }));
  assert.equal(pausedPrepared.data.status.success, true);
  const pausedExecutionId = created(pausedPrepared.data, '::node_execution::CommandExecution');
  const before = await sdk.okr.getOkr(drafts[1].id);
  const pause = await body(drafts[1].logicalId, 'agreement', 'contract', 2n, JSON.stringify({ reason: 'Pause to free one ACTIVE slot', previousAgreement: 1 }));
  assert.equal((await execute('OKR: pause releases ACTIVE slot and invalidates agreement version', sdk.okr.pause({ ...authorized, ...pause, okrId: drafts[1].id, expectedVersion: before.version, expectedRecordRevision: 1n }))).data.status.success, true);
  assert.equal((await sdk.okr.getOkr(drafts[1].id)).agreement_version, '2');
  const pausedStart = await execute('OKR binding: paused OKR rejects old prepared start', sdk.nodeExecution.beginCommand({ ...authorized, membershipId: o.membershipId, bindingId: o.bindingId, managedAgentId: o.managedAgentId, executionId: pausedExecutionId, capabilityId: pausedCapabilityId, okrId: drafts[1].id }), o.host, undefined, true);
  assert.equal(pausedStart.data.status.success, false); assert.match(JSON.stringify(pausedStart.data.status), /9403/);
  assert.equal((await sdk.nodeExecution.getExecution(pausedExecutionId)).state, 0);
  const cancelPaused = await execute('OKR binding: historical queued claim can cancel after pause', sdk.nodeExecution.requestStop({ ...authorized, okrId: drafts[1].id, executionId: pausedExecutionId, capabilityId: pausedCapabilityId }));
  assert.equal(cancelPaused.data.status.success, true);
  assert.equal((await sdk.okr.getBudget(drafts[1].id)).reserved, 0n);

  await activate(drafts[3]);
  assert.equal((await sdk.okr.getIndex(o.organizationId)).active_count, '3');
  const stale = await execute('OKR: stale version cannot replace criteria', sdk.okr.replaceSpec({ ...authorized, ...criteria, ...drafts[1].spec, okrId: drafts[1].id, expectedVersion: before.version }), o.desktop, undefined, true);
  assert.equal(stale.data.status.success, false); assert.match(JSON.stringify(stale.data.status), /9402/);
  async function achieve(expectedVersion: string, allowed: boolean) {
    const acceptance = await body(first.logicalId, 'acceptance', 'evidence', 1n, JSON.stringify({ successCriteriaReviewed: true, reason: 'Human checked both actual file hashes and their Run evidence' }));
    const made = await execute(allowed ? 'OKR: human separately accepts success criteria' : 'OKR: measurements alone cannot achieve the Objective', sdk.okr.achieve({ ...authorized, ...acceptance, okrId: first.id, expectedVersion, successCriteriaConfirmed: true }), o.desktop, undefined, !allowed);
    assert.equal(made.data.status.success, allowed);
    if (!allowed) assert.match(JSON.stringify(made.data.status), /9403/);
  }
  await achieve('2', false);
  return {
    okrId: first.id,
    unknownContext: { okrId: drafts[2].id },
    pausedProof: { okrId: drafts[1].id, capabilityId: pausedCapabilityId, executionId: pausedExecutionId },
    async finish(executionId: string, evidenceId: string, dispatch: (step: { okrId: string; capabilityId: string; agreementVersion: string; krIndex: string; files: Array<{ path: string; content: string }>; maxCalls: bigint; expiresAtMs: number }) => Promise<{ executionId: string; evidenceId: string; runtimeEvidence: Record<string, unknown> }>) {
      const run = await sdk.nodeExecution.getExecution(executionId);
      const observedByEnvd = await sdk.okr.getOkr(first.id);
      assert.equal(observedByEnvd.metrics[0].run_id, executionId); assert.equal(observedByEnvd.metrics[0].evidence_id, evidenceId); assert.equal(observedByEnvd.metrics[0].current, '2');
      const observe = () => sdk.okr.observe({ okrId: first.id, organizationId: o.organizationId, membershipId: o.membershipId, bindingId: o.bindingId, managedAgentId: o.managedAgentId, capabilityId: run.capability_id, executionId, evidenceId, expectedVersion: observedByEnvd.version, expectedAgreement: 1n, krIndex: 0n, current: 2n, sampledAtMs: run.updated_at_ms });
      const forged = await execute('OKR: another Host cannot submit measurements', observe(), o.wrongHost, undefined, true);
      assert.equal(forged.data.status.success, false); assert.match(JSON.stringify(forged.data.status), /9405/);
      const measured = await sdk.okr.getOkr(first.id);
      assert.equal(measured.metrics[0].verified, false); assert.equal(measured.next_kr, '0');
      assert.equal(metricProgress({ baseline: measured.metrics[0].baseline, target: measured.metrics[0].target, current: measured.metrics[0].current, sampledAtMs: measured.metrics[0].sampled_at_ms, maxAgeMs: measured.metrics[0].max_age_ms }, Date.now()), 1);
      await achieve(measured.version, false);
      const verification = await body(first.logicalId, 'verification', 'evidence', 1n, JSON.stringify({ verifier: 'authorized Human', ruleVersion: 1, result: 'passed', evidenceId, executionId, reason: 'Two actual Host reader measurements match declared expected hashes' }));
      assert.equal((await execute('OKR: authorized human verifies KR independently of observation', sdk.okr.verifyKr({ ...authorized, ...verification, okrId: first.id, expectedVersion: measured.version, krIndex: 0n, expectedRecordRevision: 0n }))).data.status.success, true);
      const verified = await sdk.okr.getOkr(first.id);
      assert.equal(verified.state, 1); assert.equal(verified.next_kr, '1'); assert.equal(verified.metrics[0].verified, true);
      await achieve(verified.version, false);
      const originalSpecId = verified.spec_record;
      const originalSpecText = originals.get(`okr-${first.logicalId}-spec`)!;
      const originalVerificationId = verified.metrics[0].verification_id!;
      const originalVerificationText = originals.get(`okr-${first.logicalId}-verification`)!;
      const pauseCurrent = await body(first.logicalId, 'agreement', 'contract', 2n, JSON.stringify({ reason: 'Human asks to revise the goal after reviewing KR0', priorAgreement: verified.agreement_version }));
      assert.equal((await execute('OKR replan: pause running objective and invalidate old agreement', sdk.okr.pause({ ...authorized, ...pauseCurrent, okrId: first.id, expectedVersion: verified.version, expectedRecordRevision: 1n }))).data.status.success, true);
      const paused = await sdk.okr.getOkr(first.id);
      const rejectedVerification = await body(first.logicalId, 'verification', 'evidence', 2n, JSON.stringify({ reason: 'Must not verify while paused' }));
      const cannotVerify = await execute('OKR replan: paused objective cannot reuse old verification', sdk.okr.verifyKr({ ...authorized, ...rejectedVerification, okrId: first.id, expectedVersion: paused.version, krIndex: 1n, expectedRecordRevision: 1n }), o.desktop, undefined, true);
      assert.equal(cannotVerify.data.status.success, false); assert.match(JSON.stringify(cannotVerify.data.status), /9403/);
      const approval = await body(first.logicalId, 'agreement', 'contract', 3n, JSON.stringify({ managedAgentId: o.managedAgentId, boundaryHash: Array.from(boundaryHash), budget: { asset: 'TOOL_CALLS', limit: '14' }, order: 'sequential', reason: 'Reapprove revised goals without resetting spent budget' }));
      const reapprove = { ...authorized, ...approval, okrId: first.id, expectedVersion: paused.version, membershipId: o.membershipId, bindingId: o.bindingId, managedAgentId: o.managedAgentId, workspaceHash: Uint8Array.from(managed.workspace_hash), boundaryHash, budgetAsset: 'TOOL_CALLS', budgetLimit: 14n, expiresAtMs: criteria.deadlineMs - 1, expectedRecordRevision: 2n };
      const belowSpent = await execute('OKR replan: cannot approve budget below already spent amount', sdk.okr.activate({ ...reapprove, budgetLimit: 6n }), o.desktop, undefined, true);
      assert.equal(belowSpent.data.status.success, false); assert.match(JSON.stringify(belowSpent.data.status), /9409/);
      const revisedSpec = await body(first.logicalId, 'spec', 'okr', 2n, JSON.stringify({ objective: 'Revised: retain approved README and produce final deliverable', successCriteria: ['README matches the existing approved bytes', 'FINAL.md matches approved content'], metrics: [{ unit: 'verified file', scale: 1, baseline: 0, target: 1 }, { unit: 'verified file', scale: 1, baseline: 0, target: 1 }] }));
      assert.equal((await execute('OKR replan: replace criteria and clear previous metric verification', sdk.okr.replaceSpec({ ...authorized, ...revisedSpec, ...criteria, targets: [1n, 1n], okrId: first.id, expectedVersion: paused.version }))).data.status.success, true);
      const revised = await sdk.okr.getOkr(first.id);
      assert.equal(revised.next_kr, '0'); assert.ok(revised.metrics.every(metric => !metric.verified && metric.current === null));
      const staleApproval = await execute('OKR replan: old approval version cannot reactivate revised spec', sdk.okr.activate(reapprove), o.desktop, undefined, true);
      assert.equal(staleApproval.data.status.success, false); assert.match(JSON.stringify(staleApproval.data.status), /9402/);
      assert.equal((await execute('OKR replan: explicitly reapprove current spec', sdk.okr.activate({ ...reapprove, expectedVersion: revised.version }))).data.status.success, true);
      const resumed = await sdk.okr.getOkr(first.id);
      assert.equal(resumed.agreement_version, '4');
      assert.equal((await sdk.okr.getBudget(first.id)).spent, 7n);
      const nextCapability = await execute('OKR replan: issue new version-bound authority without resetting global budget', sdk.okr.issueCapability({ ...authorized, okrId: first.id, membershipId: o.membershipId, bindingId: o.bindingId, managedAgentId: o.managedAgentId, expectedVersion: resumed.version, maxUses: 2n }));
      assert.equal(nextCapability.data.status.success, true);
      const nextCapabilityId = created(nextCapability.data, '::remote_authority::RemoteCapability');
      const oldCommand = await signNodeCommand(o.desktop, { target: { organizationId: o.organizationId, nodeId: o.host.getPublicKey().toSuiAddress(), agentId: managed.instance_id }, action: 'assign', scope: 'control', capability: { id: run.capability_id, revocationVersion: 1n }, budget: { asset: 'TOOL_CALLS', amount: 1n }, payload: { okr: { id: first.id, agreement_version: resumed.agreement_version, kr_index: '0' }, bounds: { paths: { 'file.read': ['.'], 'file.write': ['.'] }, max_calls: '1' }, task: 'old capability must never resume this new agreement' }, expiresAtMs: Math.min(Date.now() + 300000, Number(resumed.expires_at_ms) - 1) });
      const oldDenied = await execute('OKR replan: old capability cannot claim new agreement', await sdk.nodeExecution.prepareCommand({ ...authorized, membershipId: o.membershipId, bindingId: o.bindingId, managedAgentId: o.managedAgentId, command: oldCommand }), o.desktop, undefined, true);
      assert.equal(oldDenied.data.status.success, false); assert.match(JSON.stringify(oldDenied.data.status), /8321/);
      const oldEvidence = await execute('OKR replan: old agreement evidence cannot populate reset metrics', sdk.okr.observe({ okrId: first.id, organizationId: o.organizationId, membershipId: o.membershipId, bindingId: o.bindingId, managedAgentId: o.managedAgentId, capabilityId: run.capability_id, executionId, evidenceId, expectedVersion: resumed.version, expectedAgreement: resumed.agreement_version, krIndex: 0n, current: 2n, sampledAtMs: run.updated_at_ms }), o.host, undefined, true);
      assert.equal(oldEvidence.data.status.success, false); assert.match(JSON.stringify(oldEvidence.data.status), /8321/);
      const steps = [
        { files: [{ path: 'README.md', content: 'FractalMind: human-approved native goal\n' }], maxCalls: 1n },
        { files: [{ path: 'FINAL.md', content: 'FractalMind: final KR deliverable after explicit reapproval\n' }], maxCalls: 3n },
      ];
      const sequential: Array<{ executionId: string; evidenceId: string; runtimeEvidence: Record<string, unknown> }> = [];
      for (const [index, step] of steps.entries()) {
        const current = await sdk.okr.getOkr(first.id);
        assert.equal(current.next_kr, index.toString());
        const result = await dispatch({ ...step, okrId: first.id, capabilityId: nextCapabilityId, agreementVersion: current.agreement_version, krIndex: current.next_kr, expiresAtMs: Math.min(Date.now() + 300000, Number(current.expires_at_ms) - 1) });
        sequential.push(result);
        const execution = await sdk.nodeExecution.getExecution(result.executionId);
        const measured = await sdk.okr.getOkr(first.id);
        assert.equal(measured.metrics[index].run_id, result.executionId); assert.equal(measured.metrics[index].evidence_id, result.evidenceId); assert.equal(measured.metrics[index].current, '1');
        assert.equal(measured.metrics[index].verified, false);
        await achieve(measured.version, false);
        const review = await body(first.logicalId, 'verification', 'evidence', BigInt(index + 2), JSON.stringify({ ruleVersion: 2, krIndex: index, executionId: result.executionId, evidenceId: result.evidenceId, reason: 'Human reviewed actual post-reapproval file reader evidence' }));
        assert.equal((await execute('OKR sequential: human verifies current KR ' + index, sdk.okr.verifyKr({ ...authorized, ...review, okrId: first.id, expectedVersion: measured.version, krIndex: current.next_kr, expectedRecordRevision: BigInt(index + 1) }))).data.status.success, true);
      }
      const fullyVerified = await sdk.okr.getOkr(first.id);
      assert.equal(fullyVerified.next_kr, '2'); assert.ok(fullyVerified.metrics.every(metric => metric.verified));
      await achieve(fullyVerified.version, true);
      const accepted = await sdk.okr.getOkr(first.id);
      assert.equal(accepted.state, 3); assert.equal(accepted.accepted_by_human, o.humanId); assert.ok(accepted.acceptance_record);
      assert.equal((await sdk.okr.getIndex(o.organizationId)).active_count, '2');
      // A fresh SDK paginates the organization directory without saved OKR IDs.
      const fresh = new FractalMindSDK({ packageId: sdk.client.packageId, registryId: sdk.client.registryId, client: sdk.client.client, network: 'localnet' });
      const listed: string[] = []; let cursor: string | null = null;
      do { const page = await fresh.okr.listOkrs(o.organizationId, cursor, 2); listed.push(...page.okrs.map(okr => okr.id)); cursor = page.cursor; } while (cursor);
      assert.deepEqual(listed.sort(), drafts.map(draft => draft.id).sort());
      const history = await fresh.okr.listObservations(first.id);
      assert.equal(history.observations.length, 3);
      const prior = history.observations.find(sample => sample.run_id === executionId)!;
      assert.equal(prior.agreement_version, '1'); assert.equal(prior.evidence_id, evidenceId); assert.equal(prior.current, '2');
      for (const [index, step] of sequential.entries()) {
        const sample = history.observations.find(sample => sample.run_id === step.executionId)!;
        assert.equal(sample.agreement_version, '4'); assert.equal(sample.kr_index, index.toString()); assert.equal(sample.evidence_id, step.evidenceId);
      }
      const historicalBodies = [{ recordId: originalSpecId, plaintext: originalSpecText }, { recordId: originalVerificationId, plaintext: originalVerificationText }];
      for (const body of historicalBodies) assert.equal(new TextDecoder().decode((await fresh.productRecord.decryptRecord(body.recordId, o.contentKey)).plaintext), body.plaintext);
      const enumerated = []; cursor = null;
      do { const page = await fresh.okr.listExecutions(first.id, cursor, 2); enumerated.push(...page.executions); cursor = page.cursor; } while (cursor);
      assert.equal(enumerated.length, 4);
      assert.equal(enumerated.reduce((sum, execution) => sum + BigInt(execution.claim.spent), 0n), 11n);
      assert.ok(enumerated.every(execution => execution.claim.settled));
      const pointers: Array<{ logicalId: string; plaintext: string }> = [];
      for (const [logicalId, plaintext] of originals) {
        try {
          const record = await sdk.productRecord.getCurrent(o.organizationId, logicalId.endsWith('-spec') ? 'okr' : logicalId.endsWith('-agreement') ? 'contract' : 'evidence', logicalId);
          assert.equal(new TextDecoder().decode((await sdk.productRecord.decryptRecord(record.record_id, o.contentKey)).plaintext), plaintext);
          pointers.push({ logicalId, plaintext });
        } catch (error) { throw new Error(`Unable to reconstruct OKR body ${logicalId}`, { cause: error }); }
      }
      const totals = await sdk.okr.getBudget(first.id);
      const globalBudget = { asset: totals.asset, spent: totals.spent.toString(), reserved: totals.reserved.toString() };
      const globalClaim = await sdk.okr.getReservationBudget(first.id, executionId);
      return { historicalBodies, sequential, executionDirectoryCount: enumerated.length, automaticEnvdMeasurements: true, explicitReplanningVerified: true, globalBudget, globalClaim, pausedProof: { okrId: drafts[1].id, capabilityId: pausedCapabilityId, executionId: pausedExecutionId }, okrId: first.id, draftIds: drafts.map(draft => draft.id), accepted, observations: history.observations, records: pointers, cacheFreeOrganizationDirectory: true, actualFileRunEvidence: true, separateObservationVerificationAcceptance: true, runtimeAuthorizationBoundToOkr: true, multiKrRuntimeVerified: true };
    },
  };
}
