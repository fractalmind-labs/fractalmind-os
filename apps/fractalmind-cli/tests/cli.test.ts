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

test('a blocked draft reports a machine-readable human approval request', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'fm-cli-test-'));
  const file = join(dir, 'draft.json'), errors: string[] = [];
  try {
    await writeFile(file, JSON.stringify({ objective: 'A draft' }));
    const code = await run(['okr', 'draft', 'create', '--file', file], { out: () => {}, err: line => errors.push(line) });
    assert.equal(code, 8);
    assert.deepEqual(JSON.parse(errors[0]!), {
      error: 'needs_approval', code: 8,
      detail: 'The deployed okr::create_draft entry point requires an APPROVE grant. Agent Operators are permanently limited to READ+OPERATE.',
      approval: { status: 'not_filed', requestedBy: 'agent_operator_grant', action: 'okr.draft.create', title: 'A draft', body: 'Create the supplied OKR draft; the Agent cannot activate it.' },
      how_to_file: 'Ask a human with an APPROVE device grant to create and approve this request in the FractalMind App.',
    });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('generic approval requests describe the contract-bound human handoff', async () => {
  const errors: string[] = [];
  const code = await run(['approval', 'request', 'okr.activate', '--title', 'Activate', '--body', 'Please review'], { out: () => {}, err: line => errors.push(line) });
  assert.equal(code, 8);
  const error = JSON.parse(errors[0]!);
  assert.equal(error.error, 'needs_approval');
  assert.equal(error.approval.action, 'approval.request.okr.activate');
  assert.equal(error.approval.status, 'not_filed');
});
