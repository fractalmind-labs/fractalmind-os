import type { Transaction, TransactionArgument } from '@mysten/sui/transactions';

/** Chunk large pure inputs within one atomic transaction. Intermediate vectors
 * are PTB values, not persisted staging objects or separate transactions. */
export function bytesArgument(tx: Transaction, packageId: string, bytes: Uint8Array): TransactionArgument {
  if (bytes.length > 65536) throw new Error('Byte payload exceeds the 64 KiB limit.');
  const chunkSize = 16000;
  let result: TransactionArgument = tx.pure.vector('u8', bytes.slice(0, chunkSize));
  for (let start = chunkSize; start < bytes.length; start += chunkSize) {
    [result] = tx.moveCall({ target: `${packageId}::wire_bytes::append_bytes`, arguments: [result, tx.pure.vector('u8', bytes.slice(start, start + chunkSize))] });
  }
  return result;
}
