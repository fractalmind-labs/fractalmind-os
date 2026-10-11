import { withPackageOrigins } from './helpers/package-origins.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { bcs } from '@mysten/sui/bcs';
import { normalizeSuiAddress as id } from '@mysten/sui/utils';
import type { ClientWithCoreApi } from '@mysten/sui/client';
import { FractalMindClient } from '../src/client.js';
import { OkrApi, metricProgress, weightedProgress } from '../src/okr.js';

test('increase/decrease and max-u64 observations preserve progress independently of acceptance', () => {
  const sample = { current: 30n, sampledAtMs: 100n, maxAgeMs: 50n };
  assert.equal(metricProgress({ ...sample, baseline: 10n, target: 50n }, 120n), 0.5);
  assert.equal(metricProgress({ ...sample, baseline: 50n, target: 10n }, 120n), 0.5);
  const max = 18446744073709551615n;
  assert.equal(metricProgress({ ...sample, baseline: max - 10n, target: max, current: max - 5n }, 120n), 0.5);
  assert.equal(metricProgress({ ...sample, baseline: 0n, target: 20n }, 120n), 1);
  assert.equal(metricProgress({ ...sample, baseline: 50n, target: 40n }, 120n), 1);
  assert.equal(metricProgress({ ...sample, baseline: 40n, target: 50n }, 120n), 0);
});
test('missing, future and expired samples remain unknown at both KR and Objective level', () => {
  const input = { baseline: 0n, target: 10n, current: null, sampledAtMs: 100n, maxAgeMs: 50n };
  assert.equal(metricProgress(input, 100n), null);
  assert.equal(metricProgress({ ...input, current: 5n }, 99n), null);
  assert.equal(metricProgress({ ...input, current: 5n }, 150n), 0.5);
  assert.equal(metricProgress({ ...input, current: 5n }, 151n), null);
  assert.equal(weightedProgress([{ progress: 1, weight: 1n }, { progress: null, weight: 2n }]), null);
});
test('weights normalize, invalid baselines and unsafe numeric inputs are rejected', () => {
  assert.equal(weightedProgress([{ progress: 1, weight: 1n }, { progress: 0, weight: 3n }]), 0.25);
  assert.throws(() => metricProgress({ baseline: 1n, target: 1n, current: 1n, sampledAtMs: 1n, maxAgeMs: 1n }, 1n));
  assert.throws(() => metricProgress({ baseline: Number.MAX_SAFE_INTEGER + 1, target: 1n, current: 1n, sampledAtMs: 1n, maxAgeMs: 1n }, 1n));
  assert.throws(() => weightedProgress([{ progress: 0.5, weight: 0n }]));
});

test('capability contract reads use original package types and reject spoofed or malformed bindings', async () => {
  const original = id('0x42'), capability = id('0x30');
  const type = `${original}::remote_authority::ExecutionContractBinding`;
  const schema = bcs.struct('ExecutionContractBinding', { contract_id: bcs.Address, agreement_version: bcs.u64(), boundary_hash: bcs.vector(bcs.u8()) });
  let responseType = type, agreement = 4, boundary: number[] = new Array(32).fill(5);
  const core = { getDynamicField: async (request: { parentId: string; name: { type: string; bcs: Uint8Array } }) => {
    assert.equal(request.parentId, capability);
    assert.equal(request.name.type, `${original}::remote_authority::ExecutionContractKey`);
    assert.deepEqual(request.name.bcs, new Uint8Array([0]));
    return { dynamicField: { value: { type: responseType, bcs: schema.serialize({ contract_id: id('0x20'), agreement_version: agreement, boundary_hash: boundary }).toBytes() } } };
  } };
  const api = new OkrApi(new FractalMindClient({ packageId: id('0x99'), originalPackageId: original, client: { core: withPackageOrigins(core, '0x99', original, ['remote_authority::ExecutionContractKey', 'remote_authority::ExecutionContractBinding']) } as unknown as ClientWithCoreApi }));
  assert.equal((await api.getCapabilityContract(capability)).agreement_version, '4');
  responseType = `${id('0x99')}::remote_authority::ExecutionContractBinding`;
  await assert.rejects(api.getCapabilityContract(capability), /type/);
  responseType = type; agreement = 0;
  await assert.rejects(api.getCapabilityContract(capability), /Invalid/);
  agreement = 4; boundary = [5];
  await assert.rejects(api.getCapabilityContract(capability), /Invalid/);
});

test('a lagging empty directory is unavailable, rather than a successful empty OKR list', async () => {
  const index = bcs.struct('OkrIndex', { active_count: bcs.u64(), records: bcs.struct('Table', { id: bcs.Address, size: bcs.u64() }) });
  const pkg = id('0x42');
  let size = 1;
  const core = {
    getDynamicField: async () => ({ dynamicField: { value: { type: `${pkg}::okr::OkrIndex`, bcs: index.serialize({ active_count: 0, records: { id: id('0x50'), size } }).toBytes() } } }),
    listDynamicFields: async () => ({ dynamicFields: [], hasNextPage: false, cursor: null }),
  };
  const api = new OkrApi(new FractalMindClient({ packageId: pkg, client: { core } as unknown as ClientWithCoreApi }));
  await assert.rejects(api.listOkrs(id('0x10')), /directory is not yet complete/);
  size = 0;
  assert.deepEqual(await api.listOkrs(id('0x10')), { okrs: [], hasNextPage: false, cursor: null });
});

test('assignAgentManager calls the upgraded OKR package with the exact agreement arguments', () => {
  const fm = new FractalMindClient({ client: {} as ClientWithCoreApi, network: 'testnet', packageId: id('0x41'), originalPackageId: id('0x40'), okrPackageId: id('0x51'), originalOkrPackageId: id('0x50') });
  const api = new OkrApi(fm);
  const base = {
    okrId: id('0x1'), organizationId: id('0x2'), humanId: id('0x3'), grantId: id('0x4'), expectedVersion: 1n,
    membershipId: id('0x5'), bindingId: id('0x6'), managedAgentId: id('0x7'),
    workspaceHash: new Uint8Array(32).fill(7), boundaryHash: new Uint8Array(32).fill(8),
    budgetAsset: 'TOOL_CALLS', budgetLimit: 50n, expiresAtMs: 5000n, expectedRecordRevision: 0n,
    keyVersion: 1n, encryptedBody: new Uint8Array([70, 77, 69, 49, ...new Array(32).fill(0)]),
  };
  const call = api.assignAgentManager(base).getData().commands.find((c) => c.$kind === 'MoveCall')!.MoveCall!;
  assert.equal(`${call.package}::${call.module}::${call.function}`, `${id('0x51')}::okr::assign_agent_manager`);
  // okr, org, human, grant, member, binding, managed, version, workspace, boundary, asset, limit, expires, revision, key, body, clock
  assert.equal(call.arguments.length, 17);
  assert.throws(() => api.assignAgentManager({ ...base, workspaceHash: new Uint8Array(31) }));
  assert.throws(() => api.assignAgentManager({ ...base, budgetLimit: 0n }));
});
