/// <reference lib="dom" />
import { pendingGasConflict } from './transaction-manager.js';
import type { TransactionJournal, TransactionJournalEntry } from './transaction-manager.js';

type Row = { key: string; namespace: string; entry: TransactionJournalEntry };
const key = (namespace: string, requestId: string) => JSON.stringify([namespace, requestId]);
const request = <T>(value: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
  value.onsuccess = () => resolve(value.result); value.onerror = () => reject(value.error);
});
const done = (tx: IDBTransaction) => new Promise<void>((resolve, reject) => {
  tx.oncomplete = () => resolve(); tx.onabort = tx.onerror = () => reject(tx.error ?? new Error('Transaction journal aborted.'));
});

/** Technical pending-digest cache for browser/WebView Apps. Atomic read/write
 * transactions serialize competing windows and gas claims. Signing keys and
 * product bodies are never stored here. Authoritative outcomes are re-read
 * from Sui even when this cache contains a previously confirmed receipt. */
export class IndexedDbTransactionJournal implements TransactionJournal {
  private opening?: Promise<IDBDatabase>;
  private readonly factory: IDBFactory;
  constructor(private readonly databaseName = 'fractalmind-transaction-journal-v1', factory?: IDBFactory) {
    this.factory = factory ?? globalThis.indexedDB;
    if (!this.factory) throw new Error('IndexedDB is unavailable; provide a durable device journal.');
  }
  private database() {
    return this.opening ??= new Promise<IDBDatabase>((resolve, reject) => {
      const open = this.factory.open(this.databaseName, 1);
      let blocked = false;
      open.onupgradeneeded = () => {
        const store = open.result.createObjectStore('attempts', { keyPath: 'key' });
        store.createIndex('namespace', 'namespace');
      };
      open.onerror = () => { this.opening = undefined; reject(open.error); };
      open.onblocked = () => { blocked = true; this.opening = undefined; reject(new Error('Transaction journal upgrade is blocked.')); };
      open.onsuccess = () => {
        if (blocked) { open.result.close(); return; }
        open.result.onversionchange = () => { open.result.close(); this.opening = undefined; };
        resolve(open.result);
      };
    });
  }
  async get(namespace: string, requestId: string) {
    const db = await this.database(), tx = db.transaction('attempts', 'readonly');
    const completion = done(tx);
    try {
      const row = await request(tx.objectStore('attempts').get(key(namespace, requestId))) as Row | undefined;
      await completion; return row?.entry;
    } catch (error) { await completion.catch(() => {}); throw error; }
  }
  async claim(entry: TransactionJournalEntry) {
    const db = await this.database(), tx = db.transaction('attempts', 'readwrite');
    const completion = done(tx), store = tx.objectStore('attempts');
    try {
      const rows = await request(store.index('namespace').getAll(entry.namespace)) as Row[];
      if (rows.some(row => row.entry.requestId === entry.requestId || pendingGasConflict(row.entry, entry))) { await completion; return false; }
      await request(store.add({ key: key(entry.namespace, entry.requestId), namespace: entry.namespace, entry } satisfies Row));
      await completion; return true;
    } catch (error) { await completion.catch(() => {}); throw error; }
  }
  async replace(entry: TransactionJournalEntry, expectedRevision: number) {
    const db = await this.database(), tx = db.transaction('attempts', 'readwrite');
    const completion = done(tx), store = tx.objectStore('attempts'), rowKey = key(entry.namespace, entry.requestId);
    try {
      const current = await request(store.get(rowKey)) as Row | undefined;
      if (!current || current.entry.revision !== expectedRevision || current.entry.digest !== entry.digest || current.entry.status !== 'pending') { await completion; return false; }
      await request(store.put({ key: rowKey, namespace: entry.namespace, entry } satisfies Row));
      await completion; return true;
    } catch (error) { await completion.catch(() => {}); throw error; }
  }
  async close() { const db = await this.opening; db?.close(); this.opening = undefined; }
}
