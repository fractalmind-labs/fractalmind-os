/** Upgrade the actual main source in an isolated localnet deployment. Never
 * use a user's UpgradeCap, keystore, or published deployment. Save each
 * original quote/outcome; an interrupted or unknown request is not replayed. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  access,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { bcs } from "@mysten/sui/bcs";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { requestSuiFromFaucetV2 } from "@mysten/sui/faucet";
import { Transaction } from "@mysten/sui/transactions";
import {
  FractalMindSDK,
  MemoryTransactionJournal,
  SelfPayTransactionManager,
  createRecoveryCode,
  recoveryKeys,
  createDeviceEncryptionKeys,
  randomContentKey,
  wrapKeys,
  encryptContent,
  recordContext,
  bytesToHex,
  createHostInviteMaterial,
  encodeHostInviteCode,
  signNodeCommand,
  nodeCommandIntentHash,
} from "@fractalmind-labs/fractalmind-sdk";
import type { SelfPayTransactionOutcome } from "@fractalmind-labs/fractalmind-sdk";

assert.ok(
  process.argv[2] && process.argv[3],
  "Pass main commit and NEW report path",
);
const output = resolve(process.argv[3]),
  progress = output + ".progress.json";
for (const path of [output, progress]) {
  try {
    await access(path);
    throw new Error("Inspect the original report; never overwrite/restart it");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}
function git(...args: string[]) {
  const result = spawnSync("git", args, {
    encoding: "utf8",
    maxBuffer: 4_000_000,
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}
const repository = git("rev-parse", "--show-toplevel").trim();
const mainCommit = git(
  "rev-parse",
  "--verify",
  process.argv[2] + "^{commit}",
).trim();
const sourceCommit = git("rev-parse", "HEAD").trim();
const contracts = "protocols/fractalmind-protocol/contracts";
const legacyPrefix = contracts + "/protocol/";
const isolated = await mkdtemp(join(tmpdir(), "fm-main-upgrade-"));
const legacy = join(isolated, "main", "protocol"),
  graph = join(isolated, "current");
const json = (value: unknown) =>
  JSON.stringify(
    value,
    (_key, v) => (typeof v === "bigint" ? v.toString() : v),
    2,
  ) + "\n";
const hash = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
const report: Record<string, any> = {
  mainCommit,
  sourceCommit,
  isolated,
  complete: false,
  checks: [],
  transactions: [],
  builds: [],
  sourceHashes: {},
  scriptSha256: hash(await readFile(process.argv[1])),
  privateKeysInReport: false,
  recoveryCodeInReport: false,
  validatorLimitsChanged: false,
  existingPublicDeploymentChanged: false,
};
const save = () => writeFile(progress, json(report));
async function check(name: string, facts: unknown = {}) {
  report.checks.push({ name, facts });
  await save();
  console.log("PASS", name);
}
async function manifest(
  path: string,
  alias: string,
  original: string,
  published?: string,
) {
  const file = join(path, "Move.toml");
  let text = (await readFile(file, "utf8")).replace(
    /^published-at = .*\n/gm,
    "",
  );
  text = text.replace(
    new RegExp(`${alias} = "0x[0-9a-f]+"`),
    `${alias} = "${original}"`,
  );
  if (published)
    text = text.replace(
      "[package]\n",
      `[package]\npublished-at = "${published}"\n`,
    );
  await writeFile(file, text);
}
async function build(name: string, path: string) {
  report.phase = "build_" + name;
  await save();
  console.log(report.phase);
  const result = spawnSync(
    "sui",
    [
      "move",
      "build",
      "--path",
      path,
      "--no-tree-shaking",
      "--dump-bytecode-as-base64",
    ],
    { encoding: "utf8", timeout: 90_000, maxBuffer: 4_000_000 },
  );
  await writeFile(join(isolated, name + ".build.log"), result.stderr);
  assert.equal(result.status, 0, result.stderr);
  const bytecode = JSON.parse(result.stdout) as {
    modules: string[];
    dependencies: string[];
    digest: number[];
  };
  await writeFile(join(isolated, name + ".bytecode.json"), json(bytecode));
  report.builds.push({
    name,
    modules: bytecode.modules.length,
    dependencies: bytecode.dependencies,
    digest: bytecode.digest,
    rawModuleBytes: bytecode.modules.reduce(
      (n, m) => n + Buffer.from(m, "base64").length,
      0,
    ),
    bytecodeSha256: hash(result.stdout),
    logSha256: hash(result.stderr),
  });
  await save();
  return bytecode;
}

const client = new SuiGrpcClient({
  baseUrl: "http://127.0.0.1:29000",
  network: "localnet",
});
const signer = Ed25519Keypair.generate();
const manager = new SelfPayTransactionManager({
  client,
  network: "localnet",
  signer,
  journal: new MemoryTransactionJournal(),
});
async function submit(name: string, transaction: Transaction, payer = manager) {
  report.phase = "prepare_" + name;
  await save();
  const quote = await payer.prepare({
    requestId: name,
    transaction,
    gasBudget: 2_000_000_000n,
  });
  const row: Record<string, unknown> = { name, quote };
  report.transactions.push(row);
  report.phase = "quoted_" + name;
  await save();
  const result = await payer.submit(quote);
  row.outcome = {
    status: result.status,
    digest: result.digest,
    actualGas: result.actualGas,
    reason: result.reason,
    objectTypes: result.transaction?.objectTypes,
    changedObjects: result.transaction?.effects?.changedObjects,
  };
  report.phase = "result_" + name;
  await save();
  assert.equal(
    result.status,
    "confirmed",
    "Query the original digest; do not automatically submit again",
  );
  const writes = result.transaction!.effects!.changedObjects.filter(
    (object) =>
      object.outputState === "ObjectWrite" ||
      object.outputState === "PackageWrite",
  );
  const signal = AbortSignal.timeout(20_000);
  for (const write of writes) {
    let visible = false;
    while (!signal.aborted) {
      try {
        const { object } = await client.core.getObject({
          objectId: write.objectId,
          signal,
        });
        if (BigInt(object.version) >= BigInt(write.outputVersion!)) {
          if (write.outputState === "PackageWrite") {
            const { response } = await client.movePackageService.getPackage({
              packageId: write.objectId,
            });
            assert.equal(response.package?.storageId, write.objectId);
          }
          visible = true;
          break;
        }
      } catch {
        /* Only repeat reads of the original output; never resubmit. */
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(
      visible,
      "Original confirmed output is not yet visible; inspect original digest",
    );
  }
  row.outputVersionsVisible = true;
  await save();
  console.log("CONFIRMED", name, result.digest);
  return result;
}
function created(result: SelfPayTransactionOutcome, suffix: string) {
  const entries = Object.entries(result.transaction!.objectTypes!).filter(
    ([, type]) => type.endsWith(suffix),
  );
  assert.equal(entries.length, 1, "Expected exactly one " + suffix);
  return entries[0][0];
}
function published(result: SelfPayTransactionOutcome) {
  const packages = result.transaction!.effects!.changedObjects.filter(
    (o) => o.outputState === "PackageWrite",
  );
  assert.equal(packages.length, 1);
  return packages[0].objectId;
}
async function snapshot(id: string) {
  const { object } = await client.core.getObject({
    objectId: id,
    include: { content: true, json: true },
  });
  assert.ok(object.content);
  return {
    objectId: object.objectId,
    type: object.type,
    contentSha256: hash(object.content),
    fields: object.json,
  };
}

try {
  report.chain = await client.core.getChainIdentifier();
  await save();
  for (const path of git(
    "-C",
    repository,
    "ls-files",
    "protocols/fractalmind-protocol/sdk/src/*.ts",
  )
    .trim()
    .split("\n")) {
    report.sourceHashes["worktree:" + path] = hash(
      await readFile(join(repository, path)),
    );
  }
  const files = git(
    "ls-tree",
    "-r",
    "--full-tree",
    "--name-only",
    mainCommit,
    "--",
    legacyPrefix,
  )
    .trim()
    .split("\n")
    .filter(
      (p) =>
        p.endsWith("/Move.toml") ||
        (p.startsWith(legacyPrefix + "sources/") && p.endsWith(".move")),
    );
  assert.ok(files.some((p) => p.endsWith("/sources/organization.move")));
  for (const path of files) {
    const source = git("show", mainCommit + ":" + path),
      destination = join(legacy, path.slice(legacyPrefix.length));
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, source);
    report.sourceHashes[mainCommit + ":" + path] = hash(source);
  }
  for (const folder of ["protocol", "okr", "direct-agent"]) {
    await cp(join(repository, contracts, folder), join(graph, folder), {
      recursive: true,
      filter: (path) => !["build", "Move.lock"].includes(basename(path)),
    });
  }
  await manifest(legacy, "fractalmind_protocol", "0x0");
  await manifest(join(graph, "protocol"), "fractalmind_protocol", "0x0");
  await requestSuiFromFaucetV2({
    host: "http://127.0.0.1:29123",
    recipient: signer.toSuiAddress(),
  });
  const originalCode = await build("main", legacy),
    publish = new Transaction();
  const [cap] = publish.publish(originalCode);
  publish.transferObjects([cap], signer.toSuiAddress());
  const original = await submit("publish-main", publish);
  const originalPackageId = (report.originalPackageId = published(original));
  const registryId = (report.registryId = created(
    original,
    "::organization::ProtocolRegistry",
  ));
  const upgradeCapId = (report.upgradeCapId = created(
    original,
    "::package::UpgradeCap",
  ));
  const old = new FractalMindSDK({
    packageId: originalPackageId,
    registryId,
    client,
    network: "localnet",
  });
  const org = await submit(
    "create-original-organization",
    old.organization.createOrganization({
      name: "Main upgrade " + basename(isolated),
      description: "Original main organization; preserve its object ID",
    }),
  );
  const organizationId = (report.organizationId = created(
    org,
    "::organization::Organization",
  ));
  const adminCapId = (report.adminCapId = created(
    org,
    "::organization::OrgAdminCap",
  ));
  const legacyObjective = new Transaction();
  legacyObjective.moveCall({
    target: `${originalPackageId}::objective::create_objective`,
    arguments: [
      legacyObjective.object(adminCapId),
      legacyObjective.object(organizationId),
      legacyObjective.pure.string("Original main objective"),
      legacyObjective.pure.vector("u8", new Uint8Array(32).fill(7)),
      legacyObjective.pure.u64(BigInt(Date.now()) + 86_400_000n),
    ],
  });
  const madeObjective = await submit(
    "create-original-objective",
    legacyObjective,
  );
  const objectiveId = (report.objectiveId = created(
    madeObjective,
    "::objective::Objective",
  ));
  const madeKr = await submit(
    "create-original-key-result",
    old.objective.createKeyResult({
      adminCapId,
      objectiveId,
      title: "Original main KR",
      targetHash: Array(32).fill(8),
    }),
  );
  const keyResultId = (report.keyResultId = created(
    madeKr,
    "::objective::KeyResult",
  ));
  report.legacyBefore = await Promise.all(
    [registryId, organizationId, adminCapId, objectiveId, keyResultId].map(
      snapshot,
    ),
  );
  await check("original main package and five existing objects confirmed");

  const currentCode = await build("current-upgrade", join(graph, "protocol")),
    upgrade = new Transaction();
  const ticket = upgrade.moveCall({
    target: "0x2::package::authorize_upgrade",
    arguments: [
      upgrade.object(upgradeCapId),
      upgrade.pure.u8(0),
      upgrade.pure.vector("u8", currentCode.digest),
    ],
  });
  const receipt = upgrade.upgrade({
    ...currentCode,
    package: originalPackageId,
    ticket,
  });
  upgrade.moveCall({
    target: "0x2::package::commit_upgrade",
    arguments: [upgrade.object(upgradeCapId), receipt],
  });
  const upgraded = await submit("upgrade-main-compatible", upgrade);
  const packageId = (report.packageId = published(upgraded));
  assert.notEqual(packageId, originalPackageId);
  assert.equal(
    Object.values(upgraded.transaction!.objectTypes!).filter((type) =>
      type.endsWith("::identity::IdentityRegistry"),
    ).length,
    0,
    "Package init is not rerun on upgrade",
  );
  report.legacyAfterUpgrade = await Promise.all(
    report.legacyBefore.map((o: { objectId: string }) => snapshot(o.objectId)),
  );
  assert.deepEqual(report.legacyAfterUpgrade, report.legacyBefore);
  const capState = await client.core.getObject({
    objectId: upgradeCapId,
    include: { json: true },
  });
  report.upgradedCap = capState.object.json;
  await check(
    "validator compatible upgrade preserves original registry, organization, cap, objective and KR bytes",
  );
  // Use the immutable package's actual BCS table. Some gRPC package descriptors
  // omit typeOrigins and can momentarily expose incomplete indexed metadata.
  const { object: packageObject } = await client.core.getObject({
    objectId: packageId,
    include: { objectBcs: true },
  });
  const envelope = bcs.Object.parse(packageObject.objectBcs);
  assert.equal(envelope.data.$kind, "Package");
  const contents = envelope.data.Package!;
  assert.equal(contents.id, packageId);
  assert.equal(contents.version, "2");
  report.typeOrigins = contents.typeOriginTable.map((t) => ({
    moduleName: t.moduleName,
    datatypeName: t.datatypeName,
    packageId: t.package,
  }));
  report.packageObjectSha256 = hash(packageObject.objectBcs);
  report.packageLinkage = Array.from(contents.linkageTable);
  const origin = (module: string, datatype: string) =>
    report.typeOrigins.find(
      (t: any) => t.moduleName === module && t.datatypeName === datatype,
    )?.packageId;
  assert.equal(origin("organization", "Organization"), originalPackageId);
  assert.equal(origin("identity", "IdentityRegistry"), packageId);
  await check(
    "actual package metadata distinguishes legacy and newly added type origins",
  );

  const sdk = new FractalMindSDK({
    packageId,
    originalPackageId,
    registryId,
    client,
    network: "localnet",
  });
  assert.deepEqual(
    await sdk.organization.getOrganization(organizationId),
    await old.organization.getOrganization(organizationId),
  );
  await submit(
    "initialize-original-registry-after-upgrade",
    sdk.identity.initializeRegistry(),
  );
  report.phase = "resolve-upgraded-identity-registry";
  await save();
  report.identityRegistryId = await sdk.identity.resolveRegistry();
  await check(
    "SDK resolves new identity directory through the original protocol registry",
  );

  // Extensions refer to the stable core runtime address, but load the exact
  // upgraded storage package through published-at and linkage.
  await manifest(
    join(graph, "protocol"),
    "fractalmind_protocol",
    originalPackageId,
    packageId,
  );
  for (const [folder, property, alias] of [
    ["okr", "okrPackageId", "fractalmind_okr"],
    ["direct-agent", "directPackageId", "fractalmind_direct"],
  ]) {
    const code = await build(folder, join(graph, folder));
    assert.ok(code.dependencies.includes(packageId));
    assert.ok(!code.dependencies.includes(originalPackageId));
    const tx = new Transaction(),
      [extensionCap] = tx.publish(code);
    tx.transferObjects([extensionCap], signer.toSuiAddress());
    report[property] = published(await submit("publish-" + folder, tx));
    await manifest(
      join(graph, folder),
      alias,
      report[property],
      report[property],
    );
  }
  await check(
    "new extensions publish against the actual upgraded core under standard validator limits",
  );
  const product = new FractalMindSDK({
    packageId,
    originalPackageId,
    registryId,
    okrPackageId: report.okrPackageId,
    directPackageId: report.directPackageId,
    client,
    network: "localnet",
  });
  // Retain the legacy ABI for compatibility, but calls to the current package
  // must use its Clock entry. Rejected simulations do not broadcast or pay Gas.
  const deprecated = new Transaction();
  deprecated.moveCall({
    target: `${packageId}::objective::create_objective`,
    arguments: [
      deprecated.object(adminCapId),
      deprecated.object(organizationId),
      deprecated.pure.string("Deprecated entry must stop"),
      deprecated.pure.vector("u8", new Uint8Array(32).fill(9)),
      deprecated.pure.u64(BigInt(Date.now()) + 86_400_000n),
    ],
  });
  await assert.rejects(
    manager.prepare({
      requestId: "reject-legacy-without-clock",
      transaction: deprecated,
      gasBudget: 2_000_000_000n,
    }),
    (error) =>
      /8399/.test(
        String((error as Error & { cause?: Error }).cause?.message ?? error),
      ),
  );
  const withClock = await submit(
    "create-objective-through-upgraded-clock-entry",
    product.objective.createObjective({
      adminCapId,
      organizationId,
      title: "Clock after upgrade",
      descriptionHash: Array(32).fill(9),
      deadlineMs: BigInt(Date.now()) + 86_400_000n,
    }),
  );
  report.clockObjectiveId = created(withClock, "::objective::Objective");
  await check(
    "current legacy ABI rejects missing Clock; current SDK Clock entry creates the original Objective type",
  );

  const code = createRecoveryCode("localnet"),
    recovery = recoveryKeys(code, "localnet"),
    encryption = createDeviceEncryptionKeys();
  const contentKey = randomContentKey();
  const keyring = new TextEncoder().encode(
    JSON.stringify({
      format: 1,
      contentKey: bytesToHex(contentKey),
      historicalKeys: { "1": bytesToHex(contentKey) },
    }),
  );
  const recoveryContext = `fractalmind.recovery-backup.v1:localnet:${recovery.address}`;
  const deviceContext = `fractalmind.device-keys.v1:localnet:${signer.toSuiAddress()}`;
  await requestSuiFromFaucetV2({
    host: "http://127.0.0.1:29123",
    recipient: recovery.address,
  });
  const recoveryPayer = new SelfPayTransactionManager({
    client,
    network: "localnet",
    signer: recovery.signer,
    journal: new MemoryTransactionJournal(),
  });
  const human = await submit(
    "create-human-after-main-upgrade",
    product.identity.createIdentity({
      identityRegistryId: report.identityRegistryId,
      network: "localnet",
      recoverySigningKey: recovery.signingPublicKey,
      recoveryEncryptionKey: recovery.encryptionPublicKey,
      encryptedBackup: await wrapKeys(
        keyring,
        recovery.encryptionPublicKey,
        recoveryContext,
      ),
      device: signer.toSuiAddress(),
      deviceEncryptionKey: encryption.publicKey,
      encryptedDeviceKeys: await wrapKeys(
        keyring,
        encryption.publicKey,
        deviceContext,
      ),
    }),
    recoveryPayer,
  );
  const humanId = (report.humanId = created(
      human,
      "::identity::HumanIdentity",
    )),
    grantId = (report.grantId = created(human, "::identity::DeviceGrant"));
  assert.equal(
    (await product.identity.locateRecovery(code, "localnet")).human.id,
    humanId,
  );
  const migration = await submit(
    "migrate-original-organization-to-human",
    product.identity.migrateOrganization({
      humanId,
      grantId,
      organizationId,
      adminCapId,
    }),
  );
  const migrated = await product.organization.getOrganization(organizationId);
  assert.equal(migrated.objectId, organizationId);
  assert.equal(migrated.admin, humanId);
  assert.equal(
    migrated.name,
    (await old.organization.getOrganization(organizationId)).name,
  );
  assert.ok(
    (await product.identity.getHuman(humanId)).organizations.includes(
      organizationId,
    ),
  );
  const capEffect = migration.transaction!.effects!.changedObjects.find(
    (object) => object.objectId === adminCapId,
  );
  assert.equal(capEffect?.inputState, "Exists");
  assert.equal(capEffect?.outputState, "DoesNotExist");
  const migratedHuman = await product.identity.getHuman(humanId);
  const { dynamicField: capField } = await client.core.getDynamicField({
    parentId: migratedHuman.admin_caps.id,
    name: {
      type: "0x2::object::ID",
      bcs: bcs.Address.serialize(organizationId).toBytes(),
    },
  });
  assert.equal(
    capField.value.type,
    `${originalPackageId}::organization::OrgAdminCap`,
  );
  assert.deepEqual(
    bcs
      .struct("OrgAdminCap", { id: bcs.Address, org_id: bcs.Address })
      .parse(capField.value.bcs),
    { id: adminCapId, org_id: organizationId },
  );
  report.migratedAdminCap = {
    originalCapId: adminCapId,
    humanCapTable: migratedHuman.admin_caps.id,
    originalCapWrapped: true,
  };
  await submit(
    "edit-migrated-organization-with-current-device",
    product.identity.updateOrganizationDescription({
      humanId,
      grantId,
      organizationId,
      description: "Stable Human controls the original main organization",
    }),
  );
  assert.equal(
    (await product.organization.getOrganization(organizationId)).description,
    "Stable Human controls the original main organization",
  );
  assert.deepEqual(
    await snapshot(objectiveId),
    report.legacyBefore.find((o: any) => o.objectId === objectiveId),
  );
  assert.deepEqual(
    await snapshot(keyResultId),
    report.legacyBefore.find((o: any) => o.objectId === keyResultId),
  );
  await check(
    "original admin cap migrates into stable Human; current device writes and original objective/KR remain unchanged",
  );

  const phone = Ed25519Keypair.generate(),
    phoneEncryption = createDeviceEncryptionKeys();
  const readDevice = await submit(
    "add-read-device-after-migration",
    product.identity.addReadDevice({
      humanId,
      grantId,
      organizationId,
      identityRegistryId: report.identityRegistryId,
      device: phone.toSuiAddress(),
      deviceEncryptionKey: phoneEncryption.publicKey,
      encryptedDeviceKeys: await wrapKeys(
        keyring,
        phoneEncryption.publicKey,
        `fractalmind.device-keys.v1:localnet:${phone.toSuiAddress()}`,
      ),
    }),
  );
  const phoneGrantId = (report.phoneGrantId = created(
    readDevice,
    "::identity::DeviceGrant",
  ));
  assert.deepEqual(
    (await product.identity.getDeviceGrant(phoneGrantId)).actions,
    [1],
  );
  await requestSuiFromFaucetV2({
    host: "http://127.0.0.1:29123",
    recipient: phone.toSuiAddress(),
  });
  const phoneManager = new SelfPayTransactionManager({
    client,
    network: "localnet",
    signer: phone,
    journal: new MemoryTransactionJournal(),
  });
  await assert.rejects(
    phoneManager.prepare({
      requestId: "reject-read-device-admin",
      gasBudget: 2_000_000_000n,
      transaction: product.identity.updateOrganizationDescription({
        humanId,
        grantId: phoneGrantId,
        organizationId,
        description: "Denied write",
      }),
    }),
    (error) =>
      /9001/.test(
        String((error as Error & { cause?: Error }).cause?.message ?? error),
      ),
  );
  await check(
    "mixed-origin read-only device still cannot administer migrated organization",
  );

  const plain = new TextEncoder().encode(
    "Original main organization: encrypted history after upgrade",
  );
  const message = await submit(
    "save-message-in-migrated-organization",
    await product.productRecord.encryptAndSave({
      humanId,
      grantId,
      organizationId,
      kind: "message",
      logicalId: "upgrade-message",
      expectedRevision: 0,
      keyVersion: 1,
      plaintext: plain,
      key: contentKey,
    }),
  );
  const recordId = (report.messageRecordId = created(
    message,
    "::product_record::EncryptedRecord",
  ));
  assert.equal(
    (
      await product.productRecord.getCurrent(
        organizationId,
        "message",
        "upgrade-message",
      )
    ).record_id,
    recordId,
  );
  assert.deepEqual(
    (await product.productRecord.decryptRecord(recordId, contentKey)).plaintext,
    plain,
  );
  assert.equal(
    (
      await product.productRecord.listHistory(
        organizationId,
        "message",
        "upgrade-message",
      )
    ).records.length,
    1,
  );
  report.messagePlaintextSha256 = hash(plain);
  const spec = new TextEncoder().encode(
    JSON.stringify({
      title: "Upgrade compatibility",
      goal: "Keep original organization and measurable criteria",
      keyResults: [{ target: 1 }],
    }),
  );
  const draft = await submit(
    "create-okr-under-migrated-original-organization",
    product.okr.createDraft({
      humanId,
      grantId,
      organizationId,
      logicalId: "upgrade-okr",
      priority: 1,
      deadlineMs: BigInt(Date.now()) + 86_400_000n,
      baselines: [0],
      targets: [1],
      weights: [1],
      maxAgesMs: [60_000],
      keyVersion: 1,
      encryptedBody: await encryptContent(
        spec,
        contentKey,
        recordContext(organizationId, "okr", "okr-upgrade-okr-spec", 1, 1),
      ),
    }),
  );
  const okrId = (report.okrId = created(draft, "::okr::Okr"));
  const okr = await product.okr.getOkr(okrId);
  assert.equal(okr.state, 0);
  assert.equal(okr.org_id, organizationId);
  assert.deepEqual(
    (await product.productRecord.decryptRecord(okr.spec_record, contentKey))
      .plaintext,
    spec,
  );
  const listSignal = AbortSignal.timeout(20_000);
  let listed = false;
  while (!listSignal.aborted) {
    try {
      assert.equal((await product.okr.listOkrs(organizationId)).okrs.length, 1);
      listed = true;
      break;
    } catch (error) {
      if (!/directory is not yet complete/.test((error as Error).message))
        throw error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  assert.ok(
    listed,
    "Read the original OKR directory; never recreate the draft",
  );
  await check(
    "new product record and extension field origins support decryptable history and measurable draft under the original organization",
  );

  const coordinator = Ed25519Keypair.generate();
  const binding = await submit(
    "create-coordinator-binding-after-upgrade",
    product.host.createCoordinatorBinding({
      humanId,
      grantId,
      organizationId,
      publicKey: coordinator.getPublicKey().toRawBytes(),
      endpoint: "http://127.0.0.1:29999",
    }),
  );
  const bindingId = (report.bindingId = created(
    binding,
    "::host::CoordinatorBinding",
  ));
  const inviteMaterial = createHostInviteMaterial("localnet");
  const invitation = await submit(
    "create-invite-after-upgrade",
    product.host.createInvite({
      humanId,
      grantId,
      organizationId,
      bindingId,
      proofPublicKey: inviteMaterial.publicKey,
      expiresAtMs: BigInt(Date.now()) + 300_000n,
    }),
  );
  const inviteId = (report.inviteId = created(
    invitation,
    "::host::HostInvite",
  ));
  const host = Ed25519Keypair.generate(),
    hostEncryption = createDeviceEncryptionKeys();
  const joinPlan = await product.host.prepareJoin({
    code: encodeHostInviteCode("localnet", inviteId, inviteMaterial.entropy),
    network: "localnet",
    hostPublicKey: host.getPublicKey().toRawBytes(),
    encryptionPublicKey: hostEncryption.publicKey,
    name: "Upgraded protocol Host fixture",
  });
  inviteMaterial.entropy.fill(0);
  await requestSuiFromFaucetV2({
    host: "http://127.0.0.1:29123",
    recipient: host.toSuiAddress(),
  });
  const hostManager = new SelfPayTransactionManager({
    client,
    network: "localnet",
    signer: host,
    journal: new MemoryTransactionJournal(),
  });
  const joined = await submit(
    "redeem-invite-after-upgrade",
    joinPlan.transaction,
    hostManager,
  );
  const membershipId = (report.membershipId = created(
    joined,
    "::host::HostMembership",
  ));
  assert.equal(
    (await product.host.getMembership(membershipId)).org_id,
    organizationId,
  );
  assert.equal((await product.host.getInvite(inviteId)).uses, 1);
  assert.ok(
    (await product.host.getIndex(organizationId)).memberships.includes(
      membershipId,
    ),
  );
  await check(
    "new Host invitation and membership origins work with the original organization and current identity",
  );
  const capability = await submit(
    "issue-current-status-capability-after-upgrade",
    product.host.issueCapability({
      humanId,
      grantId,
      organizationId,
      membershipId,
      bindingId,
      actions: ["status"],
      scope: "observation",
      expiresAtMs: BigInt(Date.now()) + 300_000n,
    }),
  );
  const capabilityId = (report.capabilityId = created(
    capability,
    "::remote_authority::RemoteCapability",
  ));
  assert.equal(
    (await product.remoteAuthority.getCapability(capabilityId)).type,
    `${originalPackageId}::remote_authority::RemoteCapability`,
  );
  const issuedAtMs = Date.now();
  const command = await signNodeCommand(signer, {
    commandId: "upgrade-status",
    nonce: "upgrade-nonce",
    idempotencyKey: "upgrade-status",
    target: { organizationId, nodeId: host.toSuiAddress(), agentId: "" },
    action: "status",
    scope: "observation",
    capability: { id: capabilityId, revocationVersion: 1n },
    issuedAtMs,
    expiresAtMs: issuedAtMs + 120_000,
    payload: {},
  });
  const preparation = await submit(
    "prepare-new-run-on-original-capability",
    await product.nodeExecution.prepareCommand({
      humanId,
      grantId,
      membershipId,
      bindingId,
      command,
      resultKey: { organizationKey: contentKey, keyVersion: 1 },
    }),
  );
  const executionId = (report.executionId = created(
    preparation,
    "::node_execution::CommandExecution",
  ));
  assert.equal(
    (await product.nodeExecution.getExecution(executionId)).state,
    0,
  );
  assert.equal(
    (
      await product.nodeExecution.getResultKey(
        capabilityId,
        nodeCommandIntentHash(command),
        1,
      )
    ).org_id,
    organizationId,
  );
  assert.deepEqual(await product.nodeExecution.getBudget(capabilityId), {
    spent: 0n,
    reserved: 0n,
  });
  await check(
    "original RemoteCapability reads new budget field origins in the same legacy module",
  );
  await submit(
    "cancel-original-new-queued-run",
    product.nodeExecution.requestStop({
      executionId,
      capabilityId,
      organizationId,
      humanId,
      grantId,
    }),
  );
  assert.equal(
    (await product.nodeExecution.getExecution(executionId)).state,
    5,
  );
  assert.equal(
    (
      await product.nodeExecution.getReservationBudget(
        capabilityId,
        nodeCommandIntentHash(command),
      )
    ).settled,
    true,
  );
  await check(
    "new Run and result key types coexist with original capability; explicit cancellation settles the original zero-tool claim",
  );
  await submit(
    "revoke-test-host-after-upgrade",
    product.host.revokeMembership({
      humanId,
      grantId,
      organizationId,
      membershipId,
    }),
  );
  assert.equal((await product.host.getMembership(membershipId)).revoked, true);
  await check("test Host revoked through current Human authority");
  report.limits = {
    actualMainSourceUpgradedOnLocalnet: true,
    publicTestnetDeploymentUpgraded: false,
    originalOrganizationMigrated: true,
    SDKMixedTypeOriginsVerified: true,
    installedAppUpgradeVerified: false,
    envdMixedTypeOriginsVerified: false,
    originalSinglePackageProductHistoryMigrated: false,
    existingMainObjectivesConvertedToNewOKR: false,
    actualModelVerified: false,
    cloudHostVerified: false,
    recoveryInThisFixtureVerified: false,
  };
  report.complete = true;
  report.phase = "main-upgrade-deployment-verified";
  await save();
  await writeFile(output, json(report));
  console.log(
    json({
      complete: true,
      checks: report.checks.length,
      confirmedTransactions: report.transactions.length,
      packageId,
      originalPackageId,
    }),
  );
} catch (error) {
  const e = error as Error & { code?: string; cause?: unknown };
  report.failure = {
    phase: report.phase,
    name: e.name,
    code: e.code,
    message: e.message.slice(0, 3000),
    cause:
      e.cause instanceof Error ? e.cause.message.slice(0, 3000) : undefined,
  };
  await save();
  throw error;
}
