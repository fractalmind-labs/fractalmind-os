import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { FractalMindSDK, encryptContent, recordContext, metricProgress } from '../src/index.js';
import type { ProductRecordKind } from '../src/index.js';
import type { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import type { Transaction } from '@mysten/sui/transactions';
import type { SuiClientTypes } from '@mysten/sui/client';
type Data = SuiClientTypes.Transaction<{ effects: true; objectTypes: true; events: true }>;
type Execute = (label: string, tx: Transaction, signer?: Ed25519Keypair, sponsor?: Ed25519Keypair, allowRejected?: boolean) => Promise<{ data: Data }>;
type Options = { sdk: FractalMindSDK; execute: Execute; created: (data: Data, suffix: string) => string; organizationId: string; humanId: string; grantId: string; membershipId: string; bindingId: string; managedAgentId: string; desktop: Ed25519Keypair; host: Ed25519Keypair; wrongHost: Ed25519Keypair; contentKey: Uint8Array };

/** This slice tests typed OKR lifecycle against actual file-run evidence. The
 * execution capability still needs a version-bound OKR authorization bridge;
 * declaring an agreement here does not claim it is enforced by that runtime. */
export async function prepareOkrAcceptance(o: Options, boundaryHash: Uint8Array) {
  const { sdk, execute, created } = o;
  const authorized = { organizationId: o.organizationId, humanId: o.humanId, grantId: o.grantId };
  const criteria = { priority: 0, deadlineMs: Date.now() + 3600000, baselines: [0n], targets: [2n], weights: [1n], maxAgesMs: [3600000n] };
  const originals = new Map<string, string>();
  async function body(logicalId: string, suffix: string, kind: ProductRecordKind, revision: bigint, plaintext: string) {
    const name = `okr-${logicalId}-${suffix}`;
    originals.set(name, plaintext);
    return { keyVersion: 1n, encryptedBody: await encryptContent(new TextEncoder().encode(plaintext), o.contentKey, recordContext(o.organizationId, kind, name, revision, 1n)) };
  }
  const drafts: Array<{ id: string; logicalId: string; spec: Awaited<ReturnType<typeof body>> }> = [];
  for (let i = 0; i < 4; i++) {
    const logicalId = randomUUID();
    const spec = await body(logicalId, 'spec', 'okr', 1n, JSON.stringify({ format: 1, objective: 'Two declared file outcomes are measured and human accepted', successCriteria: ['Both text-file goals match their expected hashes'], metric: { unit: 'verified files', scale: 1, baseline: 0, target: 2, source: 'Host post-write reader', freshnessMs: 3600000 } }));
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
    const agreement = await body(draft.logicalId, 'agreement', 'contract', 1n, JSON.stringify({ format: 1, managedAgentId: o.managedAgentId, boundaryHash: Array.from(boundaryHash), budget: { asset: 'TOOL_CALLS', limit: '10' }, order: 'sequential', verifier: 'authorized human' }));
    const made = await execute(allowed ? 'OKR: activate one explicitly managed Agent' : 'OKR: fourth ACTIVE is rejected atomically', sdk.okr.activate({ ...authorized, ...agreement, okrId: draft.id, expectedVersion: 1n, membershipId: o.membershipId, bindingId: o.bindingId, managedAgentId: o.managedAgentId, workspaceHash: Uint8Array.from(managed.workspace_hash), boundaryHash, budgetAsset: 'TOOL_CALLS', budgetLimit: 10n, expiresAtMs: Date.now() + 300000, expectedRecordRevision: 0n }), o.desktop, undefined, !allowed);
    assert.equal(made.data.status.success, allowed);
    if (!allowed) assert.match(JSON.stringify(made.data.status), /9404/);
  }
  for (const draft of drafts.slice(0, 3)) await activate(draft);
  await activate(drafts[3], false);
  assert.equal((await sdk.okr.getIndex(o.organizationId)).active_count, '3');
  assert.equal((await sdk.okr.getOkr(drafts[3].id)).state, 0);
  const before = await sdk.okr.getOkr(drafts[1].id);
  const pause = await body(drafts[1].logicalId, 'agreement', 'contract', 2n, JSON.stringify({ reason: 'Pause to free one ACTIVE slot', previousAgreement: 1 }));
  assert.equal((await execute('OKR: pause releases ACTIVE slot and invalidates agreement version', sdk.okr.pause({ ...authorized, ...pause, okrId: drafts[1].id, expectedVersion: before.version, expectedRecordRevision: 1n }))).data.status.success, true);
  assert.equal((await sdk.okr.getOkr(drafts[1].id)).agreement_version, '2');
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
    async finish(executionId: string, evidenceId: string) {
      const run = await sdk.nodeExecution.getExecution(executionId);
      const observe = () => sdk.okr.observe({ okrId: first.id, organizationId: o.organizationId, membershipId: o.membershipId, bindingId: o.bindingId, managedAgentId: o.managedAgentId, executionId, evidenceId, expectedVersion: 2n, expectedAgreement: 1n, krIndex: 0n, current: 2n, sampledAtMs: run.updated_at_ms });
      const forged = await execute('OKR: another Host cannot submit measurements', observe(), o.wrongHost, undefined, true);
      assert.equal(forged.data.status.success, false); assert.match(JSON.stringify(forged.data.status), /9405/);
      assert.equal((await execute('OKR: admitted Host submits actual successful Run evidence', observe(), o.host)).data.status.success, true);
      const measured = await sdk.okr.getOkr(first.id);
      assert.equal(measured.metrics[0].verified, false); assert.equal(measured.next_kr, '0');
      assert.equal(metricProgress({ baseline: measured.metrics[0].baseline, target: measured.metrics[0].target, current: measured.metrics[0].current, sampledAtMs: measured.metrics[0].sampled_at_ms, maxAgeMs: measured.metrics[0].max_age_ms }, Date.now()), 1);
      await achieve(measured.version, false);
      const verification = await body(first.logicalId, 'verification', 'evidence', 1n, JSON.stringify({ verifier: 'authorized Human', ruleVersion: 1, result: 'passed', evidenceId, executionId, reason: 'Two actual Host reader measurements match declared expected hashes' }));
      assert.equal((await execute('OKR: authorized human verifies KR independently of observation', sdk.okr.verifyKr({ ...authorized, ...verification, okrId: first.id, expectedVersion: measured.version, krIndex: 0n, expectedRecordRevision: 0n }))).data.status.success, true);
      const verified = await sdk.okr.getOkr(first.id);
      assert.equal(verified.state, 1); assert.equal(verified.next_kr, '1'); assert.equal(verified.metrics[0].verified, true);
      await achieve(verified.version, true);
      const accepted = await sdk.okr.getOkr(first.id);
      assert.equal(accepted.state, 3); assert.equal(accepted.accepted_by_human, o.humanId); assert.ok(accepted.acceptance_record);
      assert.equal((await sdk.okr.getIndex(o.organizationId)).active_count, '2');
      // A fresh SDK paginates the organization directory without saved OKR IDs.
      const fresh = new FractalMindSDK({ packageId: sdk.client.packageId, registryId: sdk.client.registryId, client: sdk.client.client, network: 'localnet' });
      const listed: string[] = []; let cursor: string | null = null;
      do { const page = await fresh.okr.listOkrs(o.organizationId, cursor, 2); listed.push(...page.okrs.map(okr => okr.id)); cursor = page.cursor; } while (cursor);
      assert.deepEqual(listed.sort(), drafts.map(draft => draft.id).sort());
      const history = await fresh.okr.listObservations(first.id);
      assert.equal(history.observations.length, 1);
      assert.equal(history.observations[0].run_id, executionId);
      assert.equal(history.observations[0].evidence_id, evidenceId);
      assert.equal(history.observations[0].current, '2');
      const pointers: Array<{ logicalId: string; plaintext: string }> = [];
      for (const [logicalId, plaintext] of originals) {
        try {
          const record = await sdk.productRecord.getCurrent(o.organizationId, logicalId.endsWith('-spec') ? 'okr' : logicalId.endsWith('-agreement') ? 'contract' : 'evidence', logicalId);
          assert.equal(new TextDecoder().decode((await sdk.productRecord.decryptRecord(record.record_id, o.contentKey)).plaintext), plaintext);
          pointers.push({ logicalId, plaintext });
        } catch (error) { throw new Error(`Unable to reconstruct OKR body ${logicalId}`, { cause: error }); }
      }
      return { okrId: first.id, draftIds: drafts.map(draft => draft.id), accepted, observations: history.observations, records: pointers, cacheFreeOrganizationDirectory: true, actualFileRunEvidence: true, separateObservationVerificationAcceptance: true, runtimeAuthorizationBoundToOkr: false, multiKrRuntimeVerified: false };
    },
  };
}
