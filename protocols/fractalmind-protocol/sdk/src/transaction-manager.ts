import { bcs } from '@mysten/sui/bcs';
import type { ClientWithCoreApi, SuiClientTypes } from '@mysten/sui/client';
import type { Signer } from '@mysten/sui/cryptography';
import { Transaction } from '@mysten/sui/transactions';
import { normalizeSuiAddress, normalizeStructTag, toBase64, isValidTransactionDigest } from '@mysten/sui/utils';
import { verifyTransactionSignature } from '@mysten/sui/verify';
import { toBigInt } from './client.js';
import type { NetworkName, U64Input } from './types.js';

const SUI = normalizeStructTag('0x2::sui::SUI');
const COIN = normalizeStructTag('0x2::coin::Coin<0x2::sui::SUI>');
const Coin = bcs.struct('Coin', { id: bcs.Address, balance: bcs.u64() });
const include = { effects: true, objectTypes: true, events: true, balanceChanges: true, transaction: true } as const;
export type SelfPayTransactionData = SuiClientTypes.Transaction<typeof include>;
type GasReference = { objectId: string; version: string; digest: string };
export type TransactionJournalEntry = {
  format: 1; namespace: string; requestId: string; revision: number; digest: string;
  sender: string; gasBudget: string; maxSuiSpend: string; estimatedGas: string;
  gasReferences: GasReference[]; addressGas: boolean; createdAtMs: number;
  status: 'pending' | 'confirmed' | 'failed'; gasUsed?: SuiClientTypes.GasCostSummary;
  actualGas?: string; failure?: string;
};
/** A device-local technical journal. Entries contain no transaction bytes,
 * signatures, private keys or product bodies. Persistent product state is Sui.
 * claim() must atomically reject duplicate requests AND overlapping pending gas. */
export interface TransactionJournal {
  get(namespace: string, requestId: string): Promise<TransactionJournalEntry | undefined>;
  claim(entry: TransactionJournalEntry): Promise<boolean>;
  replace(entry: TransactionJournalEntry, expectedRevision: number): Promise<boolean>;
}
export type SelfPayFeeQuote = Readonly<{
  requestId: string; namespace: string; digest: string; sender: string;
  balance: string; requiredBalance: string; gasBudget: string; maxSuiSpend: string;
  estimatedGas: string; simulatedSuiSpend: string; expiresAtMs: number;
}>;
export type SelfPayTransactionOutcome = {
  status: 'confirmed' | 'failed' | 'unknown'; digest: string; requestId: string;
  reason?: string; gasUsed?: SuiClientTypes.GasCostSummary; actualGas?: string;
  journalSynced: boolean; transaction?: SelfPayTransactionData;
};
export class TransactionPreflightError extends Error {
  constructor(public readonly code: 'invalid_request' | 'needs_funds' | 'gas_unavailable' | 'rpc_unavailable' | 'simulation_failed' | 'value_limit_exceeded' | 'already_recorded' | 'stale_quote' | 'signature_not_obtained' | 'journal_unavailable' | 'gas_reserved', message: string, options?: ErrorOptions) {
    super(message, options); this.name = 'TransactionPreflightError';
  }
}
type Prepared = { bytes: Uint8Array; entry: TransactionJournalEntry; used: boolean };
export type SelfPayTransactionManagerOptions = {
  client: ClientWithCoreApi; network: NetworkName;
  signer: Pick<Signer, 'getPublicKey' | 'signTransaction'>; journal: TransactionJournal;
  now?: () => number; quoteTtlMs?: number;
};

export function pendingGasConflict(a: TransactionJournalEntry, b: TransactionJournalEntry): boolean {
  if (a.namespace !== b.namespace || a.status !== 'pending' || b.status !== 'pending') return false;
  return a.addressGas && b.addressGas || a.gasReferences.some(ref => b.gasReferences.some(other => other.objectId === ref.objectId));
}
export function gasCost(summary: SuiClientTypes.GasCostSummary): string {
  const computation = toBigInt(summary.computationCost), storage = toBigInt(summary.storageCost);
  const rebate = toBigInt(summary.storageRebate); toBigInt(summary.nonRefundableStorageFee);
  // The non-refundable fee is already included in storageCost. A net rebate
  // may exceed costs; do not clamp it or charge it a second time.
  return (computation + storage - rebate).toString();
}

/** Test/reference store. Apps must provide a durable device journal. */
export class MemoryTransactionJournal implements TransactionJournal {
  private readonly entries = new Map<string, TransactionJournalEntry>();
  private key(namespace: string, requestId: string) { return JSON.stringify([namespace, requestId]); }
  async get(namespace: string, requestId: string) { const row = this.entries.get(this.key(namespace, requestId)); return row ? structuredClone(row) : undefined; }
  async claim(entry: TransactionJournalEntry) {
    const key = this.key(entry.namespace, entry.requestId);
    if (this.entries.has(key) || [...this.entries.values()].some(row => pendingGasConflict(row, entry))) return false;
    this.entries.set(key, structuredClone(entry)); return true;
  }
  async replace(entry: TransactionJournalEntry, expectedRevision: number) {
    const key = this.key(entry.namespace, entry.requestId), current = this.entries.get(key);
    if (!current || current.revision !== expectedRevision || current.digest !== entry.digest || current.status !== 'pending') return false;
    this.entries.set(key, structuredClone(entry)); return true;
  }
}

export class SelfPayTransactionManager {
  private readonly prepared = new WeakMap<SelfPayFeeQuote, Prepared>();
  private readonly flights = new Map<string, Promise<SelfPayTransactionOutcome>>();
  constructor(private readonly options: SelfPayTransactionManagerOptions) {
    const ttl = options.quoteTtlMs ?? 60000;
    if (!Number.isSafeInteger(ttl) || ttl < 1 || ttl > 120000) throw new TransactionPreflightError('invalid_request', 'Quote TTL must be 1..120000ms.');
    if (options.client.network && options.client.network !== options.network) throw new TransactionPreflightError('invalid_request', 'Client network differs from transaction network.');
  }
  private now() { return (this.options.now ?? Date.now)(); }
  private async namespace() {
    let chain: { chainIdentifier: string };
    try { chain = await this.options.client.core.getChainIdentifier(); }
    catch (cause) { throw new TransactionPreflightError('rpc_unavailable', 'Cannot verify the transaction network.', { cause }); }
    if (!chain.chainIdentifier) throw new TransactionPreflightError('rpc_unavailable', 'Missing chain identifier.');
    return JSON.stringify([this.options.network, chain.chainIdentifier, this.options.signer.getPublicKey().toSuiAddress()]);
  }
  private async journal(namespace: string, requestId: string) {
    try {
      const entry = await this.options.journal.get(namespace, requestId);
      if (entry && (entry.format !== 1 || entry.namespace !== namespace || entry.requestId !== requestId || entry.sender !== this.options.signer.getPublicKey().toSuiAddress() || !isValidTransactionDigest(entry.digest) || !Number.isSafeInteger(entry.revision) || entry.revision < 1 || !['pending', 'confirmed', 'failed'].includes(entry.status))) throw new Error('Invalid journal entry.');
      return entry;
    }
    catch (cause) { throw new TransactionPreflightError('journal_unavailable', 'Cannot read pending transaction state.', { cause }); }
  }
  async prepare(input: { requestId: string; transaction: Transaction; gasBudget: U64Input; maxSuiSpend?: U64Input }): Promise<SelfPayFeeQuote> {
    if (!/^[A-Za-z0-9._:/@+\-]{1,128}$/.test(input.requestId)) throw new TransactionPreflightError('invalid_request', 'A stable transaction request ID is required.');
    const gasBudget = toBigInt(input.gasBudget), maxSuiSpend = toBigInt(input.maxSuiSpend ?? 0);
    if (gasBudget === 0n) throw new TransactionPreflightError('invalid_request', 'Gas budget must be positive.');
    const namespace = await this.namespace(), sender = this.options.signer.getPublicKey().toSuiAddress();
    if (await this.journal(namespace, input.requestId)) throw new TransactionPreflightError('already_recorded', 'Query the original transaction before considering another submission.');
    const tx = Transaction.from(input.transaction), supplied = tx.getData();
    if (supplied.sender && normalizeSuiAddress(supplied.sender) !== sender || supplied.gasData.owner && normalizeSuiAddress(supplied.gasData.owner) !== sender) throw new TransactionPreflightError('invalid_request', 'This manager supports the signing device paying its own Gas.');
    tx.setSender(sender); tx.setGasOwner(sender); tx.setGasBudget(gasBudget);
    const required = gasBudget + maxSuiSpend;
    let balance: SuiClientTypes.Balance, references: GasReference[] = [], addressGas = false;
    try {
      balance = (await this.options.client.core.getBalance({ owner: sender, coinType: SUI })).balance;
      if (normalizeStructTag(balance.coinType) !== SUI) throw new Error('Unexpected balance asset.');
      if (toBigInt(balance.balance) < required) throw new TransactionPreflightError('needs_funds', `Required ${required} MIST; available ${balance.balance} MIST.`);
      tx.setGasPrice((await this.options.client.core.getReferenceGasPrice()).referenceGasPrice);
      await tx.build({ client: this.options.client, onlyTransactionKind: true });
      if (toBigInt(balance.addressBalance) >= required) {
        addressGas = true; tx.setGasPayment([]);
      } else {
        const excluded = new Set(tx.getData().inputs.flatMap(input => {
          if (input.$kind === 'UnresolvedObject') return [normalizeSuiAddress(input.UnresolvedObject.objectId)];
          if (input.$kind === 'Object') { const ref = input.Object; return ref.$kind === 'ImmOrOwnedObject' ? [ref.ImmOrOwnedObject.objectId] : ref.$kind === 'Receiving' ? [ref.Receiving.objectId] : [ref.SharedObject.objectId]; }
          return [];
        }));
        references = await this.gasCoins(sender, required, excluded);
        tx.setGasPayment(references);
      }
    } catch (cause) {
      if (cause instanceof TransactionPreflightError) throw cause;
      throw new TransactionPreflightError('rpc_unavailable', 'Cannot safely read funds, Gas price or transaction inputs.', { cause });
    }
    let bytes: Uint8Array, simulation: SelfPayTransactionData;
    try {
      bytes = await tx.build({ client: this.options.client });
      const result = await this.options.client.core.simulateTransaction({ transaction: new Uint8Array(bytes), include, checksEnabled: true });
      simulation = result.$kind === 'Transaction' ? result.Transaction : result.FailedTransaction;
    } catch (cause) { throw new TransactionPreflightError('rpc_unavailable', 'Cannot estimate this transaction safely.', { cause }); }
    if (!simulation.effects || simulation.status.success !== simulation.effects.status.success) throw new TransactionPreflightError('simulation_failed', 'Simulation returned inconsistent effects.');
    if (!simulation.status.success) throw new TransactionPreflightError('simulation_failed', 'Transaction simulation rejected the requested operation.');
    const estimatedGas = gasCost(simulation.effects.gasUsed);
    if (!simulation.balanceChanges) throw new TransactionPreflightError('simulation_failed', 'Simulation did not return balance changes.');
    const debit = -simulation.balanceChanges.filter(change => normalizeSuiAddress(change.address) === sender && normalizeStructTag(change.coinType) === SUI).reduce((total, change) => total + BigInt(change.amount), 0n);
    const simulatedSpend = debit - BigInt(estimatedGas);
    if (simulatedSpend > maxSuiSpend) throw new TransactionPreflightError('value_limit_exceeded', 'Simulated SUI transfer exceeds the approved value limit.');
    const digest = await Transaction.from(bytes).getDigest();
    const entry: TransactionJournalEntry = { format: 1, namespace, requestId: input.requestId, revision: 1, digest, sender, gasBudget: gasBudget.toString(), maxSuiSpend: maxSuiSpend.toString(), estimatedGas, gasReferences: references, addressGas, createdAtMs: this.now(), status: 'pending' };
    const quote: SelfPayFeeQuote = Object.freeze({ requestId: input.requestId, namespace, digest, sender, balance: balance.balance, requiredBalance: required.toString(), gasBudget: gasBudget.toString(), maxSuiSpend: maxSuiSpend.toString(), estimatedGas, simulatedSuiSpend: (simulatedSpend > 0n ? simulatedSpend : 0n).toString(), expiresAtMs: this.now() + (this.options.quoteTtlMs ?? 60000) });
    this.prepared.set(quote, { bytes, entry, used: false }); return quote;
  }
  private async gasCoins(owner: string, required: bigint, excluded: Set<string>) {
    const references: GasReference[] = []; const visited = new Set<string>(); let total = 0n, cursor: string | null = null;
    do {
      const page = await this.options.client.core.listCoins({ owner, coinType: SUI, cursor, limit: 100 });
      for (const coin of page.objects) {
        const id = normalizeSuiAddress(coin.objectId);
        if (visited.has(id)) throw new Error('Duplicate Gas coin.'); visited.add(id);
        if (excluded.has(id)) continue;
        const { object } = await this.options.client.core.getObject({ objectId: id, include: { content: true } });
        if (object.objectId !== id || !object.type || normalizeStructTag(object.type) !== COIN || !object.content || object.owner.$kind !== 'AddressOwner' || object.owner.AddressOwner !== owner) throw new Error('Invalid Gas coin provenance.');
        const value = Coin.parse(object.content);
        if (value.id !== id) throw new Error('Gas coin UID mismatch.');
        if (BigInt(value.balance) === 0n) continue;
        total += BigInt(value.balance); references.push({ objectId: id, version: object.version, digest: object.digest });
        if (total >= required) return references;
        if (references.length >= 256) throw new TransactionPreflightError('gas_unavailable', 'Too many fragmented Gas coins; consolidate explicitly.');
      }
      if (page.hasNextPage && (!page.cursor || page.cursor === cursor)) throw new Error('Invalid Gas coin page cursor.');
      cursor = page.hasNextPage ? page.cursor : null;
    } while (cursor);
    throw new TransactionPreflightError('gas_unavailable', 'Funds are unavailable for Gas or already used as transaction inputs.');
  }
  submit(quote: SelfPayFeeQuote): Promise<SelfPayTransactionOutcome> {
    const key = JSON.stringify([quote.namespace, quote.requestId]);
    const existing = this.flights.get(key); if (existing) return existing;
    const flight = this.broadcast(quote).finally(() => this.flights.delete(key));
    this.flights.set(key, flight); return flight;
  }
  private async broadcast(quote: SelfPayFeeQuote): Promise<SelfPayTransactionOutcome> {
    const prepared = this.prepared.get(quote);
    if (!prepared) throw new TransactionPreflightError('invalid_request', 'Quote was not prepared by this manager.');
    if (await this.namespace() !== quote.namespace) throw new TransactionPreflightError('invalid_request', 'Transaction network changed.');
    const prior = await this.journal(quote.namespace, quote.requestId);
    if (prior) return this.queryEntry(prior);
    if (prepared.used || quote.expiresAtMs <= this.now()) throw new TransactionPreflightError('stale_quote', 'Refresh the quote and explicitly submit again.');
    try {
      const balance = await this.options.client.core.getBalance({ owner: quote.sender, coinType: SUI });
      if (toBigInt(balance.balance.balance) < BigInt(quote.requiredBalance) || prepared.entry.addressGas && toBigInt(balance.balance.addressBalance) < BigInt(quote.requiredBalance)) throw new TransactionPreflightError('needs_funds', 'Funds changed since the quote.');
      for (const ref of prepared.entry.gasReferences) {
        const { object } = await this.options.client.core.getObject({ objectId: ref.objectId });
        if (object.version !== ref.version || object.digest !== ref.digest || object.owner.$kind !== 'AddressOwner' || object.owner.AddressOwner !== quote.sender) throw new TransactionPreflightError('stale_quote', 'Gas coin changed since the quote.');
      }
    } catch (cause) {
      if (cause instanceof TransactionPreflightError) throw cause;
      throw new TransactionPreflightError('rpc_unavailable', 'Cannot recheck funds before signing.', { cause });
    }
    let signature: string;
    try {
      const signed = await this.options.signer.signTransaction(new Uint8Array(prepared.bytes));
      if (signed.bytes !== toBase64(prepared.bytes)) throw new Error('Signer returned different transaction bytes.');
      await verifyTransactionSignature(prepared.bytes, signed.signature, { address: quote.sender });
      signature = signed.signature;
    } catch (cause) { throw new TransactionPreflightError('signature_not_obtained', 'No valid signature was obtained; nothing was broadcast.', { cause }); }
    try {
      if (!await this.options.journal.claim(prepared.entry)) {
        const recorded = await this.journal(quote.namespace, quote.requestId);
        if (recorded) return this.queryEntry(recorded);
        throw new TransactionPreflightError('gas_reserved', 'A pending transaction already reserves this Gas.');
      }
    } catch (cause) {
      if (cause instanceof TransactionPreflightError) throw cause;
      throw new TransactionPreflightError('journal_unavailable', 'Cannot durably save the digest before broadcast.', { cause });
    }
    prepared.used = true;
    try {
      const result = await this.options.client.core.executeTransaction({ transaction: new Uint8Array(prepared.bytes), signatures: [signature], include });
      return await this.confirm(prepared.entry, result.$kind === 'Transaction' ? result.Transaction : result.FailedTransaction);
    } catch { return this.queryEntry(prepared.entry); }
  }
  async query(requestId: string): Promise<SelfPayTransactionOutcome | undefined> {
    const namespace = await this.namespace(), entry = await this.journal(namespace, requestId);
    return entry ? this.queryEntry(entry) : undefined;
  }
  private async queryEntry(entry: TransactionJournalEntry): Promise<SelfPayTransactionOutcome> {
    try {
      const result = await this.options.client.core.getTransaction({ digest: entry.digest, include });
      return await this.confirm(entry, result.$kind === 'Transaction' ? result.Transaction : result.FailedTransaction);
    } catch { return { status: 'unknown', requestId: entry.requestId, digest: entry.digest, reason: 'original_transaction_not_confirmed', journalSynced: true }; }
  }
  private async confirm(entry: TransactionJournalEntry, data: SelfPayTransactionData): Promise<SelfPayTransactionOutcome> {
    if (data.digest !== entry.digest || data.effects?.transactionDigest !== entry.digest || data.status.success !== data.effects.status.success || data.transaction?.sender !== entry.sender || data.transaction.gasData.owner !== entry.sender || data.transaction.gasData.budget !== entry.gasBudget) throw new Error('Receipt differs from the prepared transaction.');
    const gasUsed = data.effects.gasUsed, actualGas = gasCost(gasUsed);
    if (BigInt(actualGas) > BigInt(entry.gasBudget)) throw new Error('Receipt exceeds its signed Gas budget.');
    const status = data.status.success ? 'confirmed' : 'failed';
    const failure = data.status.success ? undefined : JSON.stringify(data.status.error);
    const next: TransactionJournalEntry = { ...entry, revision: entry.revision + 1, status, gasUsed, actualGas, ...(failure ? { failure } : {}) };
    let synced = false;
    try {
      synced = await this.options.journal.replace(next, entry.revision);
      if (!synced) { const current = await this.journal(entry.namespace, entry.requestId); synced = current?.digest === entry.digest && current.status === status && current.actualGas === actualGas; }
    } catch { /* Known chain result stays known even if the technical cache fails. */ }
    return { status, requestId: entry.requestId, digest: entry.digest, gasUsed, actualGas, reason: failure, journalSynced: synced, transaction: data };
  }
}
