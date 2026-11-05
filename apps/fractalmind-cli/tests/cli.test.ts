import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse, run } from '../src/index.js';
import { schema } from '../src/readers.js';

test('parser keeps commands separate from flags', () => {
  assert.deepEqual(parse(['auth', 'login', '--org', 'Example', '--no-wait']), {
    command: ['auth', 'login'], values: { org: 'Example', 'no-wait': true },
  });
});

test('schema publishes the stable exit-code contract', () => {
  assert.deepEqual(schema.exits, { 0: 'ok', 2: 'usage', 3: 'needs_funding', 4: 'not_authorized', 5: 'revoked_or_expired', 6: 'chain_unreachable', 7: 'not_found', 8: 'needs_approval', 9: 'fee_exceeds_limit', 10: 'conflict' });
});

test('new command arguments are checked before any chain access', async () => {
  const errors: string[] = [], io = { out: () => {}, err: (line: string) => errors.push(line) };
  assert.equal(await run(['run', 'pause', 'not-an-object', '--dry-run'], io), 2);
  assert.equal(await run(['okr', 'draft', 'update', 'not-an-object', '--file', 'anything.json'], io), 2);
  assert.equal(await run(['kr', 'progress', '0x1', '--value', '-1'], io), 2);
  assert.equal(await run(['kr', 'evidence', 'add', '0x1'], io), 2);
  assert.equal(await run(['kr', 'evidence', 'add', '0x1', '--url', 'https://example.test', '--text', 'also'], io), 2);
  assert.equal(await run(['agent', 'message', 'instance', 'x'.repeat(4097)], io), 2);
  assert.equal(await run(['approval', 'request', 'Not valid', '--title', 't', '--body', 'b'], io), 2);
  assert.equal(await run(['task', 'create'], io), 2);
});

test('draft input is validated before any Agent authorization or transaction', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'fm-cli-test-'));
  const file = join(dir, 'draft.json'), errors: string[] = [];
  try {
    await writeFile(file, JSON.stringify({ objective: 'A draft' }));
    const code = await run(['okr', 'draft', 'create', '--file', file], { out: () => {}, err: line => errors.push(line) });
    assert.equal(code, 2);
    assert.equal(JSON.parse(errors[0]!).error, 'usage');
    assert.match(JSON.parse(errors[0]!).detail, /priority/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('approval requests now require an authorized Agent Operator rather than returning an unsent handoff', async () => {
  const errors: string[] = [];
  const code = await run(['approval', 'request', 'okr.activate', '--title', 'Activate', '--body', 'Please review'], { out: () => {}, err: line => errors.push(line) });
  assert.equal(code, 4);
  const error = JSON.parse(errors[0]!);
  assert.equal(error.error, 'not_authorized');
});
