import test from 'node:test';
import assert from 'node:assert/strict';
import { metricProgress, weightedProgress } from '../src/okr.js';

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
