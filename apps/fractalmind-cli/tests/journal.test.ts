import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileTransactionJournal } from '../src/storage.js';

const entry = (requestId: string, status: 'pending' | 'confirmed' | 'failed' = 'pending') => ({
  format: 1 as const, namespace: '["localnet","chain","0x1"]', requestId, revision: 1,
  digest: '11111111111111111111111111111111', sender: '0x1', gasBudget: '200', maxSuiSpend: '0', estimatedGas: '5',
  gasReferences: [{ objectId: '0x2', version: '1', digest: '11111111111111111111111111111111' }], addressGas: false, createdAtMs: 1, status,
});

test('file journal persists an attempt and rejects a same-id or overlapping pending retry', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'fm-cli-journal-')), prior = process.env.FM_CONFIG_DIR;
  process.env.FM_CONFIG_DIR = dir;
  try {
    const journal = new FileTransactionJournal('localnet');
    assert.equal(await journal.claim(entry('one')), true);
    assert.equal(await journal.claim(entry('one')), false);
    assert.equal(await journal.claim(entry('two')), false);
    assert.equal((await journal.get(entry('one').namespace, 'one'))?.digest, entry('one').digest);
    assert.equal(await journal.replace({ ...entry('one', 'confirmed'), revision: 2, actualGas: '5' }, 1), true);
    assert.equal((await new FileTransactionJournal('localnet').get(entry('one').namespace, 'one'))?.status, 'confirmed');
  } finally {
    if (prior === undefined) delete process.env.FM_CONFIG_DIR; else process.env.FM_CONFIG_DIR = prior;
    await rm(dir, { recursive: true, force: true });
  }
});
