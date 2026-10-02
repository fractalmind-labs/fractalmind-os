/** Fresh isolated localnet publish only, never a user's wallet or keystore. */
import assert from "node:assert/strict";
import { access, readFile, writeFile } from "node:fs/promises";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { requestSuiFromFaucetV2 } from "@mysten/sui/faucet";
import { Transaction } from "@mysten/sui/transactions";
import {
  FractalMindSDK,
  SelfPayTransactionManager,
  MemoryTransactionJournal,
} from "@fractalmind-labs/fractalmind-sdk";
assert.ok(process.argv[2] && process.argv[3]);
const output = process.argv[3],
  progress = output + ".progress.json";
for (const path of [output, progress]) {
  try {
    await access(path);
    throw new Error(
      "Inspect the original publish; do not overwrite or restart",
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}
const rpc = "http://127.0.0.1:29000",
  client = new SuiGrpcClient({ baseUrl: rpc, network: "localnet" }),
  signer = Ed25519Keypair.generate();
await requestSuiFromFaucetV2({
  host: "http://127.0.0.1:29123",
  recipient: signer.toSuiAddress(),
});
const manager = new SelfPayTransactionManager({
  client,
  network: "localnet",
  signer,
  journal: new MemoryTransactionJournal(),
});
const tx = new Transaction(),
  [cap] = tx.publish(JSON.parse(await readFile(process.argv[2], "utf8")));
tx.transferObjects([cap], signer.toSuiAddress());
const publishQuote = await (async () => {
  try {
    return await manager.prepare({
      requestId: "publish-recovery-guard",
      transaction: tx,
      gasBudget: 2_000_000_000n,
    });
  } catch (error) {
    const e = error as Error & { code?: string; cause?: unknown };
    await writeFile(
      progress,
      JSON.stringify(
        {
          phase: "publish_preflight_rejected",
          publishBroadcast: false,
          code: e.code,
          error: e.message,
          cause: e.cause,
          privateKeysInReport: false,
        },
        null,
        2,
      ) + "\n",
    );
    throw error;
  }
})();
await writeFile(
  progress,
  JSON.stringify(
    {
      chain: await client.core.getChainIdentifier(),
      phase: "quoted_before_publish",
      originalRequest: publishQuote,
      privateKeysInReport: false,
    },
    null,
    2,
  ) + "\n",
);
const publish = await manager.submit(publishQuote);
await writeFile(
  progress,
  JSON.stringify(
    {
      phase: "original_publish_result",
      digest: publish.digest,
      status: publish.status,
      actualGas: publish.actualGas,
      privateKeysInReport: false,
    },
    null,
    2,
  ) + "\n",
);
assert.equal(publish.status, "confirmed");
const data = publish.transaction!;
const packageId = data.effects!.changedObjects.find(
  (o) => o.outputState === "PackageWrite",
)!.objectId;
const matches = Object.entries(data.objectTypes!).filter(([, type]) =>
  type.endsWith("::organization::ProtocolRegistry"),
);
assert.equal(matches.length, 1);
const registryId = matches[0][0];
const until = Date.now() + 15000;
while (true) {
  try {
    await client.core.getObject({ objectId: registryId });
    break;
  } catch (error) {
    if (Date.now() > until) throw error;
    await new Promise((r) => setTimeout(r, 100));
  }
}
const sdk = new FractalMindSDK({
  packageId,
  registryId,
  client,
  network: "localnet",
});
const initQuote = await manager.prepare({
  requestId: "initialize-recovery-registry",
  transaction: sdk.identity.initializeRegistry(),
  gasBudget: 200_000_000n,
});
await writeFile(
  progress,
  JSON.stringify(
    {
      phase: "quoted_before_registry_init",
      packageId,
      registryId,
      publishDigest: publish.digest,
      originalRequest: initQuote,
      privateKeysInReport: false,
    },
    null,
    2,
  ) + "\n",
);
const init = await manager.submit(initQuote);
await writeFile(
  progress,
  JSON.stringify(
    {
      phase: "original_registry_init_result",
      packageId,
      registryId,
      publishDigest: publish.digest,
      digest: init.digest,
      status: init.status,
      actualGas: init.actualGas,
      privateKeysInReport: false,
    },
    null,
    2,
  ) + "\n",
);
assert.equal(init.status, "confirmed");
const report = {
  recordedAt: new Date().toISOString(),
  chain: await client.core.getChainIdentifier(),
  packageId,
  registryId,
  checks: [
    {
      action: "publish guarded recovery test package",
      digest: publish.digest,
      actualGas: publish.actualGas,
    },
    {
      action: "initialize isolated identity registry",
      digest: init.digest,
      actualGas: init.actualGas,
    },
  ],
  limits: { isolatedLocalnet: true, rawPrivateKeysInReport: false },
};
await writeFile(process.argv[3], JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ packageId, registryId, report: process.argv[3] }));
