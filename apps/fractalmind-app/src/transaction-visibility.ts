import type { SelfPayTransactionOutcome } from "@fractalmind-labs/fractalmind-sdk";
import { ChainReadSession } from "./chain";
export class TransactionVisibilityError extends Error {
  readonly code = "invalid_source";
}

/** Read exact receipt output versions. Query lag is not transaction failure;
 * polling never signs, rebroadcasts or persists business state. */
export async function awaitTransactionVisible(
  chain: ChainReadSession,
  outcome: SelfPayTransactionOutcome,
  attempts = 40,
) {
  if (outcome.status !== "confirmed") return false;
  if (
    !outcome.transaction?.effects ||
    !Number.isInteger(attempts) ||
    attempts < 1 ||
    attempts > 40
  )
    throw new TransactionVisibilityError("invalid receipt");
  const writes = outcome.transaction.effects.changedObjects.filter(
    (x) => x.outputState === "ObjectWrite" && x.outputVersion,
  );
  if (!writes.length) throw new TransactionVisibilityError("invalid receipt");
  await chain.checkNetwork();
  for (let n = 0; n < attempts; n++) {
    let ready = true;
    for (const write of writes) {
      try {
        const { object } = await chain.sdk.client.client.core.getObject({
          objectId: write.objectId,
        });
        if (object.objectId !== write.objectId)
          throw new TransactionVisibilityError("invalid receipt object");
        if (BigInt(object.version) < BigInt(write.outputVersion!))
          ready = false;
      } catch (e) {
        if (
          typeof e === "object" &&
          e &&
          "reason" in e &&
          e.reason === "notFound" &&
          "objectId" in e &&
          e.objectId === write.objectId
        )
          ready = false;
        else throw e;
      }
    }
    if (ready) {
      await chain.checkNetwork();
      return true;
    }
    if (n + 1 < attempts)
      await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}
