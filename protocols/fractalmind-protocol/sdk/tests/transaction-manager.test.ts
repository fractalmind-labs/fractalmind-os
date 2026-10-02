import test from 'node:test';
import assert from 'node:assert/strict';
import { bcs } from '@mysten/sui/bcs';
import type { ClientWithCoreApi } from '@mysten/sui/client';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import { normalizeSuiAddress as id, toBase58 } from '@mysten/sui/utils';
import { SelfPayTransactionManager, MemoryTransactionJournal, TransactionPreflightError, gasCost } from '../src/transaction-manager.js';
import type { SelfPayTransactionData, SelfPayTransactionManagerOptions } from '../src/transaction-manager.js';
import { createSelfPayOkrSubmitter } from '../src/selfpay-okr-submit.js';

function fixture() {
  const device = Ed25519Keypair.generate(), recipient = Ed25519Keypair.generate().toSuiAddress();
  const owner = device.toSuiAddress(), coinId = id('0x1'), coinDigest = toBase58(new Uint8Array(32).fill(7));
  const journal = new MemoryTransactionJournal();
  const receipts = new Map<string, SelfPayTransactionData>();
  const gasUsed = { computationCost: '100', storageCost: '20', storageRebate: '5', nonRefundableStorageFee: '7' };
  let amount = 10000n, version = '1', clock = 100000, signing = 0, executing = 0, queries = 0, chain = 'test-chain';
  let mode: 'known' | 'lost' | 'offline' | 'failed' = 'known';
  let rpcFailure = false, simulationRejected = false, ledgerAvailable = true, signRejected = false, badReceipt = false, extraSpend = 1n;
  function tx() { const transaction = new Transaction(); const [one] = transaction.splitCoins(transaction.gas, [1]); transaction.transferObjects([one], recipient); return transaction; }
  async function receipt(bytes: Uint8Array, success = true): Promise<SelfPayTransactionData> {
    const transaction = Transaction.from(bytes), digest = await transaction.getDigest();
    const status = success ? { success: true as const, error: null } : { success: false as const, error: { kind: 'MoveAbort', message: 'Expected test abort' } as never };
    return { digest, signatures: [], epoch: '1', timestampMs: null, checkpoint: null, status,
      balanceChanges: [{ coinType: '0x2::sui::SUI', address: owner, amount: (-115n - extraSpend).toString() }], objectTypes: {}, events: [], transaction: transaction.getData(), bcs: undefined,
      effects: { bcs: null, version: 2, status, gasUsed, transactionDigest: digest, gasObject: null, eventsDigest: null, dependencies: [], lamportVersion: '2', changedObjects: [], unchangedConsensusObjects: [], auxiliaryDataDigest: null } };
  }
  const core = {
    getChainIdentifier: async () => ({ chainIdentifier: chain }),
    getBalance: async () => { if (rpcFailure) throw new Error('RPC offline'); return { balance: { coinType: '0x2::sui::SUI', balance: amount.toString(), coinBalance: amount.toString(), addressBalance: '0' } }; },
    getReferenceGasPrice: async () => ({ referenceGasPrice: '1' }),
    listCoins: async () => ({ objects: [{ objectId: coinId, balance: amount.toString() }], hasNextPage: false, cursor: null }),
    getObject: async () => ({ object: { objectId: coinId, version, digest: coinDigest, owner: { $kind: 'AddressOwner', AddressOwner: owner }, type: '0x2::coin::Coin<0x2::sui::SUI>', content: bcs.struct('Coin', { id: bcs.Address, balance: bcs.u64() }).serialize({ id: coinId, balance: amount }).toBytes() } }),
    simulateTransaction: async (input: { transaction: Uint8Array }) => { const data = await receipt(input.transaction, !simulationRejected); return data.status.success ? { $kind: 'Transaction', Transaction: data } : { $kind: 'FailedTransaction', FailedTransaction: data }; },
    executeTransaction: async (input: { transaction: Uint8Array }) => {
      executing++;
      if (mode === 'offline') throw new Error('Connection lost before a response');
      const data = await receipt(input.transaction, mode !== 'failed'); receipts.set(data.digest, structuredClone(data));
      if (mode === 'lost') throw new Error('Execution receipt lost');
      if (badReceipt) data.transaction.sender = recipient;
      return data.status.success ? { $kind: 'Transaction', Transaction: data } : { $kind: 'FailedTransaction', FailedTransaction: data };
    },
    getTransaction: async (input: { digest: string }) => {
      queries++; assert.ok([...receipts.keys()].includes(input.digest) || mode === 'offline');
      if (!ledgerAvailable || !receipts.has(input.digest)) throw new Error('Transaction not found yet');
      const data = structuredClone(receipts.get(input.digest)!); if (badReceipt) data.transaction.sender = recipient;
      return data.status.success ? { $kind: 'Transaction', Transaction: data } : { $kind: 'FailedTransaction', FailedTransaction: data };
    },
  };
  const options: SelfPayTransactionManagerOptions = { client: { network: 'localnet', core } as unknown as ClientWithCoreApi, network: 'localnet', journal, now: () => clock,
    signer: { getPublicKey: () => device.getPublicKey(), signTransaction: async bytes => { signing++; if (signRejected) throw new Error('User cancelled signing'); return device.signTransaction(bytes); } },
  };
  return { tx, noValue: () => { extraSpend = 0n; return new Transaction(); }, options, journal, manager: () => new SelfPayTransactionManager(options), input: (requestId = 'create-okr') => ({ requestId, transaction: tx(), gasBudget: 1000n, maxSuiSpend: 1n }),
    mode: (value: typeof mode) => { mode = value; }, ledger: (value: boolean) => { ledgerAvailable = value; }, funds: (value: bigint) => { amount = value; }, rpcFailure: () => { rpcFailure = true; }, rejectSimulation: () => { simulationRejected = true; }, rejectSigning: () => { signRejected = true; }, badReceipt: (value: boolean) => { badReceipt = value; }, overspend: () => { extraSpend = 2n; }, gasChanged: () => { version = '2'; }, expire: () => { clock += 60000; }, changeChain: () => { chain = 'other-chain'; }, stats: () => ({ signing, executing, queries }),
  };
}
function code(expected: TransactionPreflightError['code']) { return (error: unknown) => error instanceof TransactionPreflightError && error.code === expected; }

test('fee quote does not sign/broadcast; actual net Gas includes rebate and does not double-count storage fee', async () => {
  const f = fixture(), manager = f.manager(), quote = await manager.prepare(f.input());
  assert.equal(quote.estimatedGas, '115'); assert.equal(quote.requiredBalance, '1001'); assert.equal(quote.simulatedSuiSpend, '1');
  assert.deepEqual(f.stats(), { signing: 0, executing: 0, queries: 0 });
  const result = await manager.submit(quote);
  assert.equal(result.status, 'confirmed'); assert.equal(result.actualGas, '115'); assert.equal(result.journalSynced, true);
  assert.equal(gasCost({ computationCost: '5', storageCost: '4', storageRebate: '10', nonRefundableStorageFee: '3' }), '-1');
});

test('insufficient funds and unavailable RPC remain distinct and never obtain a signature', async () => {
  const empty = fixture(); empty.funds(1000n);
  await assert.rejects(empty.manager().prepare(empty.input()), code('needs_funds')); assert.equal(empty.stats().signing, 0);
  const offline = fixture(); offline.rpcFailure();
  await assert.rejects(offline.manager().prepare(offline.input()), code('rpc_unavailable')); assert.equal(offline.stats().executing, 0);
});

test('concurrent submission joins one broadcast; new manager queries the same digest rather than resubmitting', async () => {
  const f = fixture(), manager = f.manager(), quote = await manager.prepare(f.input());
  const [a, b] = await Promise.all([manager.submit(quote), manager.submit(quote)]);
  assert.equal(a.digest, b.digest); assert.equal(f.stats().executing, 1); assert.equal(f.stats().signing, 1);
  assert.equal((await f.manager().query(quote.requestId))!.digest, quote.digest); assert.equal(f.stats().executing, 1);
  await assert.rejects(f.manager().prepare(f.input()), code('already_recorded'));
});

test('lost receipt and missing digest remain unknown across restart until the original ledger result appears', async () => {
  const f = fixture(), manager = f.manager(), quote = await manager.prepare(f.input()); f.mode('lost'); f.ledger(false);
  assert.equal((await manager.submit(quote)).status, 'unknown');
  assert.equal((await manager.submit(quote)).status, 'unknown');
  assert.equal((await f.manager().query(quote.requestId))!.status, 'unknown');
  assert.equal(f.stats().executing, 1); assert.equal(f.stats().signing, 1);
  f.ledger(true); const resolved = await f.manager().query(quote.requestId);
  assert.equal(resolved!.status, 'confirmed'); assert.equal(resolved!.actualGas, '115'); assert.equal(f.stats().executing, 1);
});

test('unknown transaction reserves Gas against another request, including a fresh manager', async () => {
  const f = fixture(), manager = f.manager(); f.mode('offline');
  const quote = await manager.prepare(f.input()); assert.equal((await manager.submit(quote)).status, 'unknown');
  const second = f.manager(), other = await second.prepare(f.input('different-operation'));
  await assert.rejects(second.submit(other), code('gas_reserved')); assert.equal(f.stats().executing, 1);
});

test('validator failure is a known failed transaction with actual charged Gas', async () => {
  const f = fixture(), manager = f.manager(), quote = await manager.prepare(f.input()); f.mode('failed');
  const result = await manager.submit(quote); assert.equal(result.status, 'failed'); assert.equal(result.actualGas, '115');
  assert.match(result.reason!, /MoveAbort/); assert.equal((await f.manager().query(quote.requestId))!.status, 'failed');
});

test('simulation rejection and unapproved value transfers stop before signing', async () => {
  const rejected = fixture(); rejected.rejectSimulation();
  await assert.rejects(rejected.manager().prepare(rejected.input()), error => {
    assert.ok(error instanceof TransactionPreflightError); assert.equal(error.code, 'simulation_failed');
    assert.deepEqual(error.cause, { kind: 'MoveAbort', message: 'Expected test abort' }); return true;
  }); assert.equal(rejected.stats().signing, 0); assert.equal(rejected.stats().executing, 0);
  const spend = fixture(); spend.overspend();
  await assert.rejects(spend.manager().prepare(spend.input()), code('value_limit_exceeded')); assert.equal(spend.stats().executing, 0);
});

test('stale Gas reference, expired quote and changed network cannot be silently rebuilt and signed', async () => {
  for (const reason of ['gas', 'time', 'network']) {
    const f = fixture(), manager = f.manager(), quote = await manager.prepare(f.input());
    if (reason === 'gas') f.gasChanged(); if (reason === 'time') f.expire(); if (reason === 'network') f.changeChain();
    await assert.rejects(manager.submit(quote), code(reason === 'network' ? 'invalid_request' : 'stale_quote')); assert.equal(f.stats().signing, 0); assert.equal(f.stats().executing, 0);
  }
});

test('signing cancellation and journal write failure never broadcast a transaction', async () => {
  const f = fixture(), manager = f.manager(), quote = await manager.prepare(f.input()); f.rejectSigning();
  await assert.rejects(manager.submit(quote), code('signature_not_obtained')); assert.equal(f.stats().executing, 0);
  assert.equal(await manager.query(quote.requestId), undefined);
  const broken = fixture(); broken.options.journal = { ...broken.journal, get: broken.journal.get.bind(broken.journal), claim: async () => { throw new Error('Disk unavailable'); }, replace: broken.journal.replace.bind(broken.journal) };
  const m = broken.manager(), q = await m.prepare(broken.input());
  await assert.rejects(m.submit(q), code('journal_unavailable')); assert.equal(broken.stats().executing, 0);
});

test('known chain result remains known when cache update fails; restart still queries the original digest', async () => {
  const f = fixture(); let fail = true;
  f.options.journal = { get: f.journal.get.bind(f.journal), claim: f.journal.claim.bind(f.journal), replace: async (entry, revision) => fail ? false : f.journal.replace(entry, revision) };
  const m = f.manager(), q = await m.prepare(f.input()), result = await m.submit(q);
  assert.equal(result.status, 'confirmed'); assert.equal(result.journalSynced, false);
  fail = false; assert.equal((await f.manager().query(q.requestId))!.journalSynced, true); assert.equal(f.stats().executing, 1);
});

test('foreign receipt and unavailable history never become authority from a cached status', async () => {
  const f = fixture(), m = f.manager(), q = await m.prepare(f.input()); f.badReceipt(true);
  assert.equal((await m.submit(q)).status, 'unknown');
  f.badReceipt(false); assert.equal((await f.manager().query(q.requestId))!.status, 'confirmed');
  f.ledger(false); assert.equal((await f.manager().query(q.requestId))!.status, 'unknown'); assert.equal(f.stats().executing, 1);
});

test('journal contains only technical metadata; forged quote and signer mutation cannot change approved bytes', async () => {
  const f = fixture(), m = f.manager(), q = await m.prepare(f.input());
  await assert.rejects(m.submit({ ...q }), code('invalid_request'));
  await m.submit(q); const stored = await f.journal.get(q.namespace, q.requestId);
  assert.ok(stored); assert.equal('transaction' in stored, false); assert.equal('signatures' in stored, false); assert.equal('bytes' in stored, false);
  const mutated = fixture(); const legitimate = mutated.options.signer;
  mutated.options.signer = { getPublicKey: legitimate.getPublicKey, signTransaction: async bytes => { bytes[10] ^= 1; return legitimate.signTransaction(bytes); } };
  const manager = mutated.manager(), quote = await manager.prepare(mutated.input());
  await assert.rejects(manager.submit(quote), code('signature_not_obtained')); assert.equal(mutated.stats().executing, 0);
});

test('OKR submitter requires fee authorization and preserves a stable request through restart', async () => {
  const f = fixture(); let approvals = 0;
  const submitter = () => createSelfPayOkrSubmitter({ manager: f.manager(), gasBudget: 1000n, approveQuote: async quote => { approvals++; assert.equal(quote.requestId, 'runner-ticket'); return true; } });
  const first = await submitter()(f.noValue(), { requestId: 'runner-ticket' });
  assert.equal(first.status, 'confirmed'); assert.equal(f.stats().executing, 1);
  const restored = await submitter()(f.noValue(), { requestId: 'runner-ticket' });
  assert.equal(restored.status, 'confirmed'); assert.equal(restored.digest, first.digest);
  assert.equal(approvals, 1); assert.equal(f.stats().executing, 1); assert.equal(f.stats().signing, 1);
});

test('OKR fee rejection does not sign; adding funds still requires explicit fee approval', async () => {
  const f = fixture(); let approvals = 0;
  const submitter = createSelfPayOkrSubmitter({ manager: f.manager(), gasBudget: 1000n, approveQuote: async () => { approvals++; return false; } });
  f.funds(0n);
  assert.equal((await submitter(f.noValue(), { requestId: 'runner-ticket' })).reason, 'needs_funds');
  assert.equal(approvals, 0); f.funds(10000n);
  const declined = await submitter(f.noValue(), { requestId: 'runner-ticket' });
  assert.equal(declined.status, 'rejected'); assert.equal(declined.reason, 'fee_approval_declined');
  assert.equal(approvals, 1); assert.equal(f.stats().executing, 0); assert.equal(f.stats().signing, 0);
});

test('OKR unknown/failed receipts are queried after restart and never automatically retried', async () => {
  for (const mode of ['lost', 'failed'] as const) {
    const f = fixture(); f.mode(mode); if (mode === 'lost') f.ledger(false);
    let approvals = 0;
    const submitter = () => createSelfPayOkrSubmitter({ manager: f.manager(), gasBudget: 1000n, approveQuote: async () => { approvals++; return true; } });
    const first = await submitter()(f.noValue(), { requestId: 'runner-ticket' });
    assert.equal(first.status, mode === 'lost' ? 'unknown' : 'rejected');
    const restored = await submitter()(f.noValue(), { requestId: 'runner-ticket' });
    assert.equal(restored.status, first.status); assert.equal(restored.digest, first.digest);
    f.ledger(true);
    assert.equal((await submitter()(f.noValue(), { requestId: 'runner-ticket' })).status, mode === 'lost' ? 'confirmed' : 'rejected');
    assert.equal(approvals, 1); assert.equal(f.stats().executing, 1);
  }
});

test('OKR unreadable transaction journal remains unknown instead of starting a new request', async () => {
  const f = fixture(); let approvals = 0;
  f.options.journal = { get: async () => { throw new Error('Device journal unavailable'); }, claim: f.journal.claim.bind(f.journal), replace: f.journal.replace.bind(f.journal) };
  const submitter = createSelfPayOkrSubmitter({ manager: f.manager(), gasBudget: 1000n, approveQuote: async () => { approvals++; return true; } });
  const result = await submitter(f.noValue(), { requestId: 'runner-ticket' });
  assert.equal(result.status, 'unknown'); assert.equal(result.reason, 'journal_unavailable');
  assert.equal(approvals, 0); assert.equal(f.stats().signing, 0); assert.equal(f.stats().executing, 0);
});
