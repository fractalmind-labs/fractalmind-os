/** Full business-history recovery on the same actual envd workload. This uses
 * production App controllers and isolated OS profiles, not installed WebView
 * storage, a physical device restart or a real model provider. */
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { requestSuiFromFaucetV2 } from "@mysten/sui/faucet";
import { toBase64 } from "@mysten/sui/utils";
import {
  MemoryTransactionJournal,
  TransactionPreflightError,
  type SelfPayFeeQuote,
  type SelfPayTransactionOutcome,
} from "@fractalmind-labs/fractalmind-sdk";
import { ChainReadSession } from "../src/chain";
import { DeviceIdentityVerifier } from "../src/device-identity";
import {
  NativeDeviceSigner,
  NativeDeviceError,
  call,
  type NativeInvoke,
} from "../src/native-device";
import { NativeImportedRecoverySigner } from "../src/native-recovery";
import { IdentityRecovery } from "../src/recovery";
import { PrivateRecords, type RecordPointer } from "../src/private-records";
import { OkrIntervention } from "../src/okr-intervention";
import { OkrProjection } from "../src/okr-projection";
import { OkrDraftCreation } from "../src/okr-draft";
import type { DraftInput } from "../src/okr-draft";
import { NativeDirectAgent } from "../src/direct-agent";
import { readMessageOkrSource } from "../src/message-okr-source";
import { NativeExecutionResults } from "../src/execution-results";
import { CoordinatorReadClient } from "../src/coordinator-read";
import { HostAdmission } from "../src/host-admission";
import type { DeploymentProfile } from "../src/onboarding";

type Options = {
  deployment: DeploymentProfile;
  chain: ChainReadSession;
  device: NativeDeviceSigner;
  grantId: string;
  invoke: NativeInvoke;
  organizationId: string;
  managedAgentId: string;
  bindingId: string;
  okrId: string;
  sourceOkrId: string;
  sourceMessageId: string;
  recoveryCode: string;
  recoveryProfiles: readonly [string, string, string];
  transportFor: (profile: string) => NativeInvoke;
  removeProfile: (profile: string) => void;
  checks: string[];
  preparedQuote: (label: string, quote: SelfPayFeeQuote) => Promise<void>;
  record: (label: string, result: SelfPayTransactionOutcome) => Promise<void>;
  checkpoint: (publicState: Record<string, unknown>) => Promise<void>;
  assertNoDispatch: () => void;
};
type HistoricalRecord = { pointer: RecordPointer; sha256: string };
const digest = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

async function history(records: PrivateRecords) {
  const rows: HistoricalRecord[] = [];
  for (const head of await records.list()) {
    let pointer = head;
    for (let depth = 0; ; depth++) {
      assert.ok(depth < 1000, "Historical chain is bounded");
      const body = await records.read(pointer, pointer !== head);
      try {
        rows.push({ pointer: { ...pointer }, sha256: digest(body) });
      } finally {
        body.fill(0);
      }
      const raw = await records.chain.sdk.productRecord.getRecord(
        pointer.record_id,
      );
      if (!raw.previous) break;
      const previous = await records.chain.sdk.productRecord.getRecord(
        raw.previous,
      );
      assert.equal(previous.revision, (BigInt(raw.revision) - 1n).toString());
      pointer = {
        kind: previous.kind,
        logicalId: previous.logical_id,
        record_id: previous.id,
        revision: previous.revision,
        key_version: previous.key_version,
      };
    }
  }
  return rows.sort((a, b) =>
    a.pointer.record_id.localeCompare(b.pointer.record_id),
  );
}

export async function nativeWorkloadRecovery(o: Options) {
  let code = o.recoveryCode;
  let previousDevice = o.device,
    previousGrant = o.grantId;
  let last:
    | {
        chain: ChainReadSession;
        device: NativeDeviceSigner;
        grantId: string;
        invoke: NativeInvoke;
      }
    | undefined;
  const originalAuthority = await new DeviceIdentityVerifier(
    o.chain,
    o.device,
    o.grantId,
  ).verifyOrganization(o.organizationId);
  const originalHistory = await history(
    new PrivateRecords(
      o.chain,
      o.device,
      o.grantId,
      o.organizationId,
      o.invoke,
    ),
  );
  assert.ok(originalHistory.length > 10);
  const projection = (
    chain: ChainReadSession,
    device: NativeDeviceSigner,
    grantId: string,
    invoke: NativeInvoke,
    okrId: string,
  ) =>
    new OkrProjection(
      new OkrIntervention(
        chain,
        device,
        grantId,
        o.organizationId,
        okrId,
        invoke,
        new MemoryTransactionJournal(),
      ),
    );
  const originalGoal = (
    await projection(o.chain, o.device, o.grantId, o.invoke, o.okrId).read()
  ).snapshot;
  const originalDraft = (
    await projection(
      o.chain,
      o.device,
      o.grantId,
      o.invoke,
      o.sourceOkrId,
    ).read()
  ).snapshot;
  assert.equal(originalGoal.state, "ACHIEVED");
  assert.equal(originalGoal.metrics.length, 2);
  assert.ok(originalGoal.metrics.every((m) => m.verified && m.verification_id));
  assert.ok(originalGoal.acceptance.recordId);
  assert.equal(originalDraft.state, "DRAFT");
  assert.equal(originalDraft.executions.length, 0);
  const originalManaged = await o.chain.sdk.host.getManagedAgent(
    o.managedAgentId,
  );
  const originalMember = await o.chain.sdk.host.getMembership(
    originalManaged.membership_id,
  );
  const originalBinding = await o.chain.sdk.host.getCoordinatorBinding(
    o.bindingId,
  );
  const originalPermission =
    await o.chain.sdk.directAgent.findPermissionForAgent(
      o.organizationId,
      o.managedAgentId,
    );
  assert.ok(originalPermission);
  const originalMessages = await o.chain.sdk.directAgent.listMessages(
    originalPermission.id,
  );
  const originalSource = await readMessageOkrSource(
    new NativeDirectAgent(
      o.chain,
      o.device,
      o.grantId,
      o.organizationId,
      o.managedAgentId,
      o.invoke,
      new MemoryTransactionJournal(),
    ),
    o.sourceMessageId,
  );
  assert.deepEqual(originalDraft.specification.source, originalSource);
  const facts = (s: typeof originalGoal) => ({
    specification: s.specification,
    state: s.state,
    nextKr: s.nextKr,
    metrics: s.metrics,
    agreement: s.agreement,
    budget: s.budget,
    executions: s.executions,
    acceptance: s.acceptance,
  });
  await o.checkpoint({
    workloadRecoveryPhase: "original_history_read",
    recoveryHistoricalRecords: originalHistory,
    recoveryOriginalGeneration: originalAuthority.generation,
  });

  let newDraftId: string | undefined;
  let newRecord: RecordPointer | undefined;
  let futureBodyHash: string | undefined;
  const rounds: unknown[] = [];
  for (let round = 0; round < 2; round++) {
    const profile = o.recoveryProfiles[round],
      invoke = o.transportFor(profile);
    await assert.rejects(
      NativeDeviceSigner.load(invoke, profile),
      /not_initialized/,
    );
    // Only a recovery code and public deployment configuration enter discovery.
    // The expected old Human/org IDs are comparisons, never recovery inputs.
    const imported = await NativeImportedRecoverySigner.import(
      invoke,
      profile,
      o.deployment.network,
      code,
    );
    const device = await NativeDeviceSigner.load(invoke, profile);
    assert.notEqual(device.device.address, previousDevice.device.address);
    const recovery = new IdentityRecovery(
      o.deployment,
      imported,
      device,
      new MemoryTransactionJournal(),
    );
    const ready = await recovery.inspect();
    assert.equal(ready.humanId, o.chain.profile.humanId);
    assert.deepEqual(
      ready.organizations.map((r) => r.objectId),
      [o.organizationId],
    );
    assert.equal(ready.phase, "ready");
    assert.equal(ready.organizations[0].keyVersion, String(round + 1));
    const prepared = await recovery.prepareReplacement();
    assert.ok(prepared.recoveryCode);
    assert.deepEqual(prepared.stage.rotations, [
      {
        organizationId: o.organizationId,
        oldVersion: String(round + 1),
        newVersion: String(round + 2),
      },
    ]);
    // Reload from a separate helper process; staged credentials reveal no code.
    const reloaded = await NativeImportedRecoverySigner.load(
      invoke,
      profile,
      o.deployment.network,
    );
    assert.deepEqual(
      (await reloaded.loadStage())!.nextRecovery,
      prepared.stage.nextRecovery,
    );
    assert.equal((await recovery.prepareReplacement()).recoveryCode, "");
    await assert.rejects(recovery.prepare(false), /backup_not_confirmed/);
    await requestSuiFromFaucetV2({
      host: "http://127.0.0.1:29123",
      recipient: imported.material.recovery.address,
    });
    // Prepare an old-device transport immediately before recovery. Its current
    // grant must be checked again after the Human generation changes.
    const previousChain = last?.chain ?? o.chain;
    const staleRead = await new CoordinatorReadClient(
      previousChain,
      previousDevice,
      previousGrant,
      o.organizationId,
    ).prepare(o.bindingId);
    const quote = await recovery.prepare(true);
    assert.ok(!("status" in quote));
    await o.preparedQuote(`native workload recovery ${round + 1}`, quote);
    await o.checkpoint({
      workloadRecoveryPhase: "recovery_quoted",
      recoveryRound: round + 1,
      recoveryTargetProfile: profile,
      recoveryQuotedDigest: quote.digest,
    });
    let broadcasts = 0;
    const execute = recovery.client.core.executeTransaction.bind(
      recovery.client.core,
    );
    recovery.client.core.executeTransaction = async (input) => {
      broadcasts++;
      return execute(input);
    };
    const outcome = await recovery.submit(quote, true);
    await o.record(`native workload recovery ${round + 1}`, outcome);
    assert.equal(broadcasts, 1);
    const restored = await recovery.awaitRecovered();
    assert.equal(restored.phase, "recovered");
    assert.equal(restored.humanId, o.chain.profile.humanId);
    assert.equal(
      restored.generation,
      (BigInt(originalAuthority.generation) + BigInt(round + 1)).toString(),
    );
    assert.equal(restored.organizations[0].keyVersion, String(round + 2));
    assert.ok(restored.grantId);
    const chain = new ChainReadSession(restored.profile),
      grantId = restored.grantId;
    last = { chain, device, grantId, invoke };
    await assert.rejects(
      new DeviceIdentityVerifier(
        chain,
        previousDevice,
        previousGrant,
      ).verifyOrganization(o.organizationId),
      /invalid_grant/,
    );
    await assert.rejects(staleRead.send(), /invalid_grant/);
    await new DeviceIdentityVerifier(chain, device, grantId).verifyOrganization(
      o.organizationId,
      "approve",
    );
    const noJournal = new IdentityRecovery(
      o.deployment,
      reloaded,
      device,
      new MemoryTransactionJournal(),
    );
    assert.equal((await noJournal.inspect()).phase, "recovered");
    await assert.rejects(noJournal.prepareReplacement(), /code_consumed/);
    await assert.rejects(noJournal.prepare(true), /code_consumed/);
    assert.equal(
      broadcasts,
      1,
      "Read-only reconstruction cannot replay recovery",
    );
    if (round === 0) {
      const usedInvoke = o.transportFor(o.recoveryProfiles[2]);
      const used = await NativeImportedRecoverySigner.import(
        usedInvoke,
        o.recoveryProfiles[2],
        o.deployment.network,
        code,
      );
      const usedDevice = await NativeDeviceSigner.load(
        usedInvoke,
        o.recoveryProfiles[2],
      );
      await assert.rejects(
        new IdentityRecovery(
          o.deployment,
          used,
          usedDevice,
          new MemoryTransactionJournal(),
        ).inspect(),
        /code_consumed/,
      );
      o.removeProfile(o.recoveryProfiles[2]);
    }
    code = prepared.recoveryCode;
    prepared.recoveryCode = "";

    const bodies = new PrivateRecords(
      chain,
      device,
      grantId,
      o.organizationId,
      invoke,
    );
    for (const expected of originalHistory) {
      const body = await bodies.read(expected.pointer, true);
      try {
        assert.equal(digest(body), expected.sha256);
      } finally {
        body.fill(0);
      }
    }
    const goal = (
      await projection(chain, device, grantId, invoke, o.okrId).read()
    ).snapshot;
    const sourceGoal = (
      await projection(chain, device, grantId, invoke, o.sourceOkrId).read()
    ).snapshot;
    assert.deepEqual(facts(goal), facts(originalGoal));
    assert.deepEqual(facts(sourceGoal), facts(originalDraft));
    assert.deepEqual(
      await chain.sdk.host.getManagedAgent(o.managedAgentId),
      originalManaged,
    );
    assert.deepEqual(
      await chain.sdk.host.getMembership(originalMember.id),
      originalMember,
    );
    assert.deepEqual(
      await chain.sdk.host.getCoordinatorBinding(o.bindingId),
      originalBinding,
    );
    assert.deepEqual(
      await chain.sdk.directAgent.getPermission(originalPermission.id),
      originalPermission,
    );
    const direct = new NativeDirectAgent(
      chain,
      device,
      grantId,
      o.organizationId,
      o.managedAgentId,
      invoke,
      new MemoryTransactionJournal(),
    );
    const described = await direct.describe();
    assert.deepEqual(described.messages, originalMessages);
    for (const message of originalMessages) {
      const view = await direct.message(message.id);
      assert.equal(view.message.id, message.id);
      assert.equal(direct.canSend(message.id), false);
    }
    assert.deepEqual(
      await readMessageOkrSource(direct, o.sourceMessageId),
      originalSource,
    );
    await assert.rejects(
      direct.prepare({ kind: "capability", messageId: o.sourceMessageId }),
    );
    for (const metric of goal.metrics) {
      const result = await new NativeExecutionResults(
        chain,
        device,
        grantId,
        o.organizationId,
        invoke,
      ).read(metric.run_id!, o.managedAgentId);
      assert.equal(result.recordId, metric.evidence_id);
      assert.equal(result.run.state, 2);
    }
    const directory = await chain.loadOrganization(o.organizationId);
    assert.ok(
      directory.okrs.value &&
        directory.agents.value &&
        directory.memberships.value &&
        directory.bindings.value &&
        directory.hosts.value,
    );
    assert.ok(
      directory.okrs.value.some(
        (r) => r.okr.id === o.okrId && r.okr.state === 3,
      ),
    );
    assert.ok(
      directory.okrs.value.some(
        (r) => r.okr.id === o.sourceOkrId && r.okr.state === 0,
      ),
    );
    const hosts = await new CoordinatorReadClient(
      chain,
      device,
      grantId,
      o.organizationId,
    ).readHosts(o.bindingId);
    await o.checkpoint({
      workloadRecoveryPhase: "restored_history_and_live_host_read",
      recoveryRound: round + 1,
      recoveryObservedHosts: hosts.map((h) => ({
        address: h.address,
        state: h.state,
        reason: h.reason,
        membershipId: h.membershipId,
        expiresAtMs: h.expiresAtMs,
      })),
      recoveryHistoricalHashesVerified: originalHistory.length,
      recoveryOriginalMessagesVerified: originalMessages.length,
    });
    assert.ok(
      hosts.some(
        (h) => h.state === "verified" && h.membershipId === originalMember.id,
      ),
    );
    o.assertNoDispatch();
    o.checks.push(
      `workload recovery ${round + 1}: only the saved code locates the stable Human; one native self-paid transaction consumes it, advances generation/key version and authorizes an independent device; old device/prepared transport and replay fail; fresh controllers restore ${originalHistory.length} exact current/historical plaintext hashes, two verified KRs/final acceptance, original Agent/Host/binding, revoked standing permission, messages/results and unchanged message-derived draft without delivery/model calls or tool spend`,
    );

    if (round === 0) {
      const draft = new OkrDraftCreation(
        chain,
        device,
        grantId,
        o.organizationId,
        randomUUID(),
        invoke,
        new MemoryTransactionJournal(),
      );
      const candidate: DraftInput = {
        objective: "Independent post-recovery document review",
        successCriteria: "Human separately approves any execution",
        priority: 0,
        deadlineMs: String(Date.now() + 3600000),
        allowedPaths: ["docs"],
        prohibitedActions: ["shell.*", "network.*"],
        maxCalls: "3",
        krs: [
          {
            title: "One independently reviewed file",
            unit: "files",
            precision: 0,
            baseline: "0",
            target: "1",
            weight: "1",
            maxAgeMinutes: "5",
            verificationRule: "Review the file and its immutable evidence",
          },
        ],
      };
      await assert.rejects(
        draft.prepare(candidate),
        (error) =>
          error instanceof TransactionPreflightError &&
          error.code === "needs_funds",
      );
      assert.equal(await draft.query(), undefined);
      await o.checkpoint({
        workloadRecoveryPhase: "new_device_needs_own_funds",
        recoveryNewDeviceAddress: device.device.address,
        recoveryNewDeviceBalance: "0",
        recoveryFundingDoesNotSubmit: true,
      });
      await requestSuiFromFaucetV2({
        host: "http://127.0.0.1:29123",
        recipient: device.device.address,
      });
      assert.equal(await draft.query(), undefined);
      const draftQuote = await draft.prepare(candidate);
      assert.ok(!("status" in draftQuote));
      await o.preparedQuote(
        "native recovered-device new key-version OKR draft",
        draftQuote,
      );
      const result = await draft.submit(draftQuote);
      await o.record(
        "native recovered-device new key-version OKR draft",
        result,
      );
      const type = `${chain.sdk.client.okrTypesPackageId}::okr::Okr`;
      const created = result.transaction!.effects.changedObjects.filter(
        (r) =>
          r.idOperation === "Created" &&
          result.transaction!.objectTypes?.[r.objectId] === type,
      );
      assert.equal(created.length, 1);
      newDraftId = created[0].objectId;
      const v = (
        await projection(chain, device, grantId, invoke, newDraftId).read()
      ).snapshot;
      assert.equal(v.state, "DRAFT");
      assert.equal(v.executions.length, 0);
      const rawOkr = await chain.sdk.okr.getOkr(newDraftId);
      const raw = await chain.sdk.productRecord.getRecord(rawOkr.spec_record);
      assert.equal(raw.key_version, "2");
      newRecord = {
        kind: raw.kind,
        logicalId: raw.logical_id,
        record_id: raw.id,
        revision: raw.revision,
        key_version: raw.key_version,
      };
      const body = await bodies.read(newRecord);
      try {
        futureBodyHash = digest(body);
      } finally {
        body.fill(0);
      }
      await o.checkpoint({
        workloadRecoveryPhase: "new_key_version_draft_confirmed",
        recoveryPostRotationDraftId: newDraftId,
        recoveryPostRotationRecordId: newRecord.record_id,
        recoveryPostRotationBodyHash: futureBodyHash,
      });
      await assert.rejects(
        call(o.invoke, "fm_device_decrypt_record", {
          profile: o.device.device.profile,
          record: JSON.stringify({
            network: o.deployment.network,
            encryptedKeys: originalAuthority.encryptedKeys,
            organizationId: o.organizationId,
            kind: raw.kind,
            logicalId: raw.logical_id,
            revision: raw.revision,
            keyVersion: raw.key_version,
            encryptedBody: toBase64(Uint8Array.from(raw.encrypted_body)),
          }),
        }),
        (error) =>
          error instanceof NativeDeviceError &&
          error.code === "invalid_envelope",
      );
      // Delete actual old OS credentials, not just a JS reference, before the
      // second code-only recovery. Business proof persists in Sui ciphertext.
      o.removeProfile(o.device.device.profile);
      o.checks.push(
        "new recovered device at zero balance cannot quote or submit; explicit isolated faucet funding creates no business transaction, then separate fee/native signature writes only a new DRAFT using key v2; the old retained key envelope cannot decrypt it and original OS test credentials are actually removed",
      );
    } else {
      assert.ok(newRecord && newDraftId && futureBodyHash);
      const body = await bodies.read(newRecord);
      try {
        assert.equal(digest(body), futureBodyHash);
      } finally {
        body.fill(0);
      }
      const v = (
        await projection(chain, device, grantId, invoke, newDraftId).read()
      ).snapshot;
      assert.equal(v.state, "DRAFT");
      assert.equal(v.executions.length, 0);
      assert.equal(
        v.specification.objective,
        "Independent post-recovery document review",
      );
      o.removeProfile(o.recoveryProfiles[0]);
      const admission = new HostAdmission(
        chain,
        device,
        grantId,
        o.organizationId,
        new MemoryTransactionJournal(),
      );
      await assert.rejects(
        admission.prepare(
          { kind: "revoke-member", targetId: originalMember.id },
          randomUUID(),
          true,
        ),
        (error) =>
          error instanceof TransactionPreflightError &&
          error.code === "needs_funds",
      );
      await requestSuiFromFaucetV2({
        host: "http://127.0.0.1:29123",
        recipient: device.device.address,
      });
      assert.deepEqual(
        await chain.sdk.host.getMembership(originalMember.id),
        originalMember,
      );
      o.checks.push(
        "second code-only recovery retains original v1 history plus the independently written v2 draft under current key v3; prior recovered-device credentials are removed, and the new device again needs explicit fixture funding before a later separately signed Host management transaction",
      );
    }
    rounds.push({
      round: round + 1,
      profile,
      digest: outcome.digest,
      actualGas: outcome.actualGas,
      humanId: restored.humanId,
      grantId,
      generation: restored.generation,
      keyVersion: restored.organizations[0].keyVersion,
      historicalRecordsVerified: originalHistory.length,
      originalMessagesVerified: originalMessages.length,
      broadcasts,
    });
    await o.checkpoint({
      workloadRecoveryPhase: "history_and_authority_verified",
      recoveryRounds: rounds,
      recoveryPostRotationDraftId: newDraftId,
      recoveryPostRotationRecordId: newRecord?.record_id,
      recoveryPostRotationBodyHash: futureBodyHash,
    });
    previousDevice = device;
    previousGrant = grantId;
  }
  code = "";
  assert.ok(last);
  return {
    ...last,
    reader: new NativeExecutionResults(
      last.chain,
      last.device,
      last.grantId,
      o.organizationId,
      last.invoke,
    ),
    admission: new HostAdmission(
      last.chain,
      last.device,
      last.grantId,
      o.organizationId,
      new MemoryTransactionJournal(),
    ),
  };
}
