/** Disposable technical markers. Losing this store never makes a restored
 * queued Run eligible for automatic delivery; only a newly prepared Run can
 * be claimed by the autonomy session that prepared it. No private bodies. */
export interface OkrDeliveryJournal {
  claim(key: string): Promise<boolean>;
}
export class IndexedDbOkrDeliveryJournal implements OkrDeliveryJournal {
  private database?: Promise<IDBDatabase>;
  private closed = false;
  private open() {
    if (this.closed) return Promise.reject(new Error("journal_unavailable"));
    return (this.database ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("fractalmind.okr-delivery.v1", 1);
      request.onupgradeneeded = () =>
        request.result.createObjectStore("attempts");
      request.onsuccess = () => {
        if (this.closed) {
          request.result.close();
          reject(new Error("journal_unavailable"));
        } else resolve(request.result);
      };
      request.onerror = () => reject(new Error("journal_unavailable"));
      request.onblocked = () => {
        this.closed = true;
        reject(new Error("journal_unavailable"));
      };
    }));
  }
  async claim(key: string) {
    if (!key || key.length > 2048) throw new Error("journal_unavailable");
    const db = await this.open();
    if (this.closed) throw new Error("journal_unavailable");
    return new Promise<boolean>((resolve, reject) => {
      const tx = db.transaction("attempts", "readwrite");
      let duplicate = false;
      const add = tx
        .objectStore("attempts")
        .add({ attemptedAtMs: Date.now() }, key);
      add.onerror = (event) => {
        if (add.error?.name === "ConstraintError") {
          duplicate = true;
          event.preventDefault();
          event.stopPropagation();
        }
      };
      tx.oncomplete = () => resolve(!duplicate);
      tx.onabort = tx.onerror = () => reject(new Error("journal_unavailable"));
    });
  }
  async close() {
    this.closed = true;
    (await this.database?.catch(() => undefined))?.close();
  }
}
export function okrDeliveryKey(
  network: string,
  chain: string,
  device: string,
  runId: string,
) {
  if (
    !network ||
    !chain ||
    ![device, runId].every((v) => /^0x[0-9a-f]{64}$/.test(v))
  )
    throw new Error("journal_unavailable");
  return JSON.stringify([network, chain, device, runId]);
}
