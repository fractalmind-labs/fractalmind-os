/** Publish the complete product package graph on isolated localnet. Temporary
 * signer stays in memory. A saved original quote/result is never replayed. */
import assert from "node:assert/strict";
import { access, readFile, writeFile, realpath } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, resolve, join } from "node:path";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { requestSuiFromFaucetV2 } from "@mysten/sui/faucet";
import { Transaction } from "@mysten/sui/transactions";
import {
  FractalMindSDK,
  SelfPayTransactionManager,
  MemoryTransactionJournal,
} from "@fractalmind-labs/fractalmind-sdk";

assert.ok(
  process.argv[2] && process.argv[3],
  "Pass isolated core path and new report",
);
const corePath = await realpath(process.argv[2]),
  graph = dirname(corePath),
  output = resolve(process.argv[3]);
assert.notEqual(
  graph,
  resolve("../../protocols/fractalmind-protocol/contracts"),
  "Never rewrite repository package addresses",
);
const progress = output + ".progress.json";
for (const path of [output, progress]) {
  try {
    await access(path);
    throw new Error(
      "Inspect the original deployment; do not overwrite/restart",
    );
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
}
assert.match(
  await readFile(join(corePath, "Move.toml"), "utf8"),
  /fractalmind_protocol = "0x0"/,
);
const client = new SuiGrpcClient({
    baseUrl: "http://127.0.0.1:29000",
    network: "localnet",
  }),
  signer = Ed25519Keypair.generate();
const chain = await client.core.getChainIdentifier();
const report: Record<string, any> = {
  chain,
  packages: [],
  complete: false,
  privateKeysInReport: false,
  validatorLimitsChanged: false,
};
const save = () => writeFile(progress, JSON.stringify(report, null, 2) + "\n");
await save();
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
async function submit(name: string, tx: Transaction) {
  try {
    const quote = await manager.prepare({
      requestId: name,
      transaction: tx,
      gasBudget: 2_000_000_000n,
    });
    report.phase = "quoted_" + name;
    report.originalQuote = quote;
    await save();
    const outcome = await manager.submit(quote);
    report.phase = "result_" + name;
    report.originalOutcome = {
      status: outcome.status,
      digest: outcome.digest,
      actualGas: outcome.actualGas,
      reason: outcome.reason,
    };
    await save();
    assert.equal(
      outcome.status,
      "confirmed",
      "Query original digest; never automatically publish again",
    );
    return outcome;
  } catch (error) {
    const e = error as Error & { code?: string; cause?: unknown };
    report.failure = { code: e.code, message: e.message, cause: e.cause };
    await save();
    throw error;
  }
}
for (const [folder, property, alias] of [
  ["protocol", "packageId", "fractalmind_protocol"],
  ["okr", "okrPackageId", "fractalmind_okr"],
  ["direct-agent", "directPackageId", "fractalmind_direct"],
]) {
  const path = join(graph, folder);
  const built = spawnSync(
    "sui",
    [
      "move",
      "build",
      "--path",
      path,
      "--no-tree-shaking",
      "--dump-bytecode-as-base64",
    ],
    { encoding: "utf8", timeout: 90000, maxBuffer: 4_000_000 },
  );
  assert.equal(built.status, 0, built.stderr);
  const bytecode = JSON.parse(built.stdout),
    tx = new Transaction();
  if (property !== "packageId")
    assert.ok(
      bytecode.dependencies.includes(report.packageId),
      "Extensions must depend on the exact published core",
    );
  const [cap] = tx.publish(bytecode);
  tx.transferObjects([cap], signer.toSuiAddress());
  const result = await submit("publish-" + folder, tx);
  const packageId = result.transaction!.effects!.changedObjects.find(
    (o) => o.outputState === "PackageWrite",
  )!.objectId;
  report[property] = packageId;
  report.packages.push({
    name: folder,
    packageId,
    digest: result.digest,
    actualGas: result.actualGas,
    modules: bytecode.modules.length,
    rawModuleBytes: bytecode.modules.reduce(
      (n: number, b: string) => n + Buffer.from(b, "base64").length,
      0,
    ),
  });
  if (property === "packageId") {
    const registries = Object.entries(result.transaction!.objectTypes!).filter(
      ([, type]) => type.endsWith("::organization::ProtocolRegistry"),
    );
    assert.equal(registries.length, 1);
    report.registryId = registries[0][0];
  }
  const manifest = join(path, "Move.toml"),
    source = await readFile(manifest, "utf8");
  await writeFile(
    manifest,
    source
      .replace(
        `[addresses]\n${alias} = "0x0"`,
        `[addresses]\n${alias} = "${packageId}"`,
      )
      .replace("[package]\n", `[package]\npublished-at = "${packageId}"\n`),
  );
  await save();
}
const sdk = new FractalMindSDK({
  packageId: report.packageId,
  okrPackageId: report.okrPackageId,
  directPackageId: report.directPackageId,
  registryId: report.registryId,
  client,
  network: "localnet",
});
report.identityRegistryId = await sdk.identity.resolveRegistry();
await sdk.identity.getRegistry(report.identityRegistryId);
report.initDigest = report.packages[0].digest;
report.identityInitialization = "atomic_with_core_publish";
report.complete = true;
report.phase = "published_three_packages";
await save();
await writeFile(output, JSON.stringify(report, null, 2) + "\n");
console.log(
  JSON.stringify({
    complete: true,
    packageId: report.packageId,
    okrPackageId: report.okrPackageId,
    directPackageId: report.directPackageId,
  }),
);
