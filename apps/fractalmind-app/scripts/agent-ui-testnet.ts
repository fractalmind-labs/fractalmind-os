/** Visual acceptance of the Agent Operators page, the expired-device notice and
 * recovery, on Sui testnet against the deployed packages
 * (docs/product/evidence/v021-testnet-deployment.json).
 *
 * Everything is a throwaway: a new Human identity, an organization named
 * "Test" (or "Test-xxxx" when taken), and device keys in generated `test-*`
 * profiles of the production native vault (device-test-helper). No user
 * profile, keychain entry or recovery code is read or written.
 *
 *   setup <fixture.json>   identity on device A, organization, and a root
 *                          device B that expires a few minutes later
 *   serve <fixture.json>   the built App (dist/) on 127.0.0.1:4189 with a
 *                          bridge that answers native commands with the helper,
 *                          for this fixture's profiles only; the page starts
 *                          signed in as device B
 *   sweep <fixture.json>   return what is left on the test addresses
 *
 * Funds come from the active `sui` CLI address (testnet has no faucet a script
 * may call). Build the helper first:
 *   (cd native && cargo build --example device-test-helper)
 */
import assert from "node:assert/strict";
import { execFile as execFileCallback, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { Transaction } from "@mysten/sui/transactions";
import { fromBase64, toBase64 } from "@mysten/sui/utils";
import {
  FractalMindSDK,
  bytesToHex,
  createRecoveryCode,
  randomContentKey,
  recoveryKeys,
  wrapKeys,
} from "@fractalmind-labs/fractalmind-sdk";

const execFile = promisify(execFileCallback);
const [mode, fixturePath] = process.argv.slice(2);
assert.ok(["setup", "serve", "sweep"].includes(mode ?? "") && fixturePath, "usage: setup|serve|sweep <fixture.json>");
const helper = resolve("native/target/debug/examples/device-test-helper");
const record = JSON.parse(
  await readFile(fileURLToPath(new URL("../../../docs/product/evidence/v021-testnet-deployment.json", import.meta.url)), "utf8"),
);
const dep = record.deployment as Record<string, string> & { rpcUrl: string; packageId: string; registryId: string };
const client = new SuiGrpcClient({ baseUrl: dep.rpcUrl, network: "testnet" });
const sdk = new FractalMindSDK({ ...(dep as never), network: "testnet", client });
const step = (text: string) => console.log(`• ${text}`);

type Fixture = {
  prefix: string;
  profiles: { a: string; b: string };
  addresses: { a: string; b: string; recovery: string };
  humanId: string;
  organizationId: string;
  organizationName: string;
  deviceBExpiresAtMs: number;
  recoveryCode: string;
  chainIdentifier: string;
};

function native(profile: string, action: string, extra: Record<string, string> = {}) {
  assert.match(profile, /^test-ui-[0-9a-f]{6}-[A-Za-z0-9_-]{1,40}$/, "only this fixture's test profiles");
  const result = spawnSync(helper, [], {
    input: JSON.stringify({ action, profile, ...extra }),
    encoding: "utf8",
    timeout: 30_000,
    maxBuffer: 2_000_000,
  });
  if (result.status !== 0) throw new Error(result.stderr.trim() || `native ${action} failed`);
  return JSON.parse(result.stdout);
}

async function eventually<T>(read: () => Promise<T>, what: string, ms = 60_000): Promise<T> {
  const deadline = Date.now() + ms;
  let last: unknown;
  while (Date.now() < deadline) {
    try {
      return await read();
    } catch (error) {
      last = error;
      await new Promise((r) => setTimeout(r, 700));
    }
  }
  throw new Error(`${what} did not become readable`, { cause: last });
}

async function balance(address: string) {
  const { balance } = await eventually(() => client.core.getBalance({ owner: address, coinType: "0x2::sui::SUI" }), `balance of ${address}`, 30_000);
  return BigInt(balance.balance);
}

async function fund(address: string, mist: bigint) {
  const before = await balance(address);
  const { stdout } = await execFile(
    "sui",
    ["client", "ptb", "--split-coins", "gas", `[${mist}]`, "--assign", "c", "--transfer-objects", "[c]", `@${address}`, "--gas-budget", "10000000", "--json"],
    { maxBuffer: 16 * 1024 * 1024 },
  );
  const result = JSON.parse(stdout.slice(stdout.indexOf("{")));
  assert.equal(result.effects.status.status, "success", `funding ${address} failed`);
  await eventually(async () => {
    if ((await balance(address)) < before + mist) throw new Error("not yet");
  }, `funds for ${address}`);
}

type Signer = (bytes: Uint8Array) => Promise<string>;
const helperSigner = (profile: string): Signer => async (bytes) => native(profile, "signTransaction", { bytes: toBase64(bytes) }).signature;

type Data = { status: { success: boolean; error?: string }; objectTypes?: Record<string, string>; effects?: { changedObjects: Array<{ objectId: string; outputState: string; outputVersion?: string }> } };
async function execute(tx: Transaction, sender: string, sign: Signer, sponsor?: { address: string; sign: Signer }, budget = 50_000_000n) {
  tx.setSender(sender);
  tx.setGasBudget(budget);
  if (sponsor) tx.setGasOwner(sponsor.address);
  const bytes = await tx.build({ client });
  const signatures = [await sign(bytes)];
  if (sponsor) signatures.push(await sponsor.sign(bytes));
  const response = await client.core.executeTransaction({ transaction: bytes, signatures, include: { effects: true, objectTypes: true } });
  const data = (response.$kind === "Transaction" ? response.Transaction : response.FailedTransaction) as unknown as Data;
  assert.equal(data.status.success, true, data.status.error);
  for (const change of data.effects?.changedObjects ?? []) {
    if (change.outputState !== "ObjectWrite" || !change.outputVersion) continue;
    await eventually(async () => {
      const current = await client.core.getObject({ objectId: change.objectId });
      if (BigInt(current.object.version) < BigInt(change.outputVersion!)) throw new Error("stale");
    }, `output ${change.objectId}`);
  }
  return data;
}
function created(data: Data, suffix: string) {
  const ids = Object.entries(data.objectTypes ?? {}).filter(([, type]) => type.endsWith(suffix)).map(([id]) => id);
  assert.equal(ids.length, 1, `expected one ${suffix}`);
  return ids[0]!;
}

async function sweep(address: string, sign: Signer, to: string) {
  const left = await balance(address);
  if (left < 3_000_000n) return 0n;
  const tx = new Transaction();
  tx.transferObjects([tx.gas], to);
  await execute(tx, address, sign, undefined, 2_000_000n);
  return left;
}

if (mode === "setup") {
  // FM_UI_PREFIX reuses the device profiles of an earlier, interrupted setup.
  const prefix = process.env.FM_UI_PREFIX ?? `test-ui-${randomBytes(3).toString("hex")}`;
  const profiles = { a: `${prefix}-a`, b: `${prefix}-b` };
  const key = (profile: string) => {
    try {
      return native(profile, "public");
    } catch {
      return native(profile, "initialize");
    }
  };
  const a = key(profiles.a), b = key(profiles.b);
  const recoveryCode = createRecoveryCode("testnet"), recovery = recoveryKeys(recoveryCode, "testnet");
  const { chainIdentifier } = await client.core.getChainIdentifier();
  step(`device A ${a.address}, device B ${b.address}, recovery ${recovery.address}`);
  const partial = { prefix, profiles, addresses: { a: a.address, b: b.address, recovery: recovery.address }, recoveryCode, chainIdentifier };
  await writeFile(fixturePath, JSON.stringify(partial, null, 2), { mode: 0o600 });
  if ((await balance(a.address)) < 60_000_000n) await fund(a.address, 80_000_000n);
  // The helper signs only transactions its device sends, so the recovery
  // address pays for the identity it creates.
  await fund(recovery.address, 60_000_000n);
  step("funded device A and the recovery address");

  const identityRegistryId = await sdk.identity.resolveRegistry();
  const contentKey = randomContentKey();
  const keyring = new TextEncoder().encode(JSON.stringify({ format: 1, contentKey: bytesToHex(contentKey), historicalKeys: { "1": bytesToHex(contentKey) } }));
  const made = await execute(
    sdk.identity.createIdentity({
      identityRegistryId,
      network: "testnet",
      recoverySigningKey: recovery.signingPublicKey,
      recoveryEncryptionKey: recovery.encryptionPublicKey,
      encryptedBackup: await wrapKeys(keyring, recovery.encryptionPublicKey, `fractalmind.recovery-backup.v1:testnet:${recovery.address}`),
      device: a.address,
      deviceEncryptionKey: fromBase64(a.encryptionPublicKey),
      encryptedDeviceKeys: await wrapKeys(keyring, fromBase64(a.encryptionPublicKey), `fractalmind.device-keys.v1:testnet:${a.address}`),
    }),
    recovery.address,
    async (bytes) => (await recovery.signer.signTransaction(bytes)).signature,
  );
  const humanId = created(made, "::identity::HumanIdentity"), grantA = created(made, "::identity::DeviceGrant");
  step(`identity ${humanId}`);

  let organizationName = "Test", org: Data | undefined;
  for (const name of ["Test", `Test-${randomBytes(2).toString("hex")}`]) {
    try {
      org = await execute(sdk.identity.createOrganization({ humanId, grantId: grantA, name, description: "FractalMind App testnet acceptance (throwaway)" }), a.address, helperSigner(profiles.a));
      organizationName = name;
      break;
    } catch (error) {
      step(`organization name ${name} not available: ${(error as Error).message.slice(0, 120)}`);
    }
  }
  assert.ok(org, "organization created");
  const organizationId = created(org, "::organization::Organization");
  step(`organization ${organizationName} ${organizationId}`);

  const deviceBExpiresAtMs = Date.now() + 5 * 60_000;
  await execute(
    sdk.identity.addRootDevice({
      identityRegistryId,
      humanId,
      grantId: grantA,
      device: b.address,
      deviceEncryptionKey: fromBase64(b.encryptionPublicKey),
      encryptedDeviceKeys: await wrapKeys(keyring, fromBase64(b.encryptionPublicKey), `fractalmind.device-keys.v1:testnet:${b.address}`),
      expiresAtMs: BigInt(deviceBExpiresAtMs),
    } as never),
    a.address,
    helperSigner(profiles.a),
  );
  contentKey.fill(0);
  step(`device B is a root device until ${new Date(deviceBExpiresAtMs).toLocaleTimeString()}`);
  const fixture: Fixture = {
    prefix, profiles, addresses: { a: a.address, b: b.address, recovery: recovery.address },
    humanId, organizationId, organizationName, deviceBExpiresAtMs, recoveryCode, chainIdentifier,
  };
  await writeFile(fixturePath, JSON.stringify(fixture, null, 2), { mode: 0o600 });
  step(`fixture written (test-only recovery code inside, mode 600)`);
}

if (mode === "serve") {
  const fixture = JSON.parse(await readFile(fixturePath, "utf8")) as Fixture;
  const dist = resolve("dist");
  const connection = {
    network: "testnet", rpcUrl: dep.rpcUrl, packageId: dep.packageId, originalPackageId: dep.originalPackageId,
    okrPackageId: dep.okrPackageId, originalOkrPackageId: dep.originalOkrPackageId, directPackageId: dep.directPackageId,
    registryId: dep.registryId, humanId: fixture.humanId, chainIdentifier: fixture.chainIdentifier,
  };
  const device = { profile: fixture.profiles.b, humanId: fixture.humanId, network: "testnet", registryId: dep.registryId, chainIdentifier: fixture.chainIdentifier };
  const bootstrap = `<script>(() => {
    if (localStorage.getItem('fm-ui-fixture') !== ${JSON.stringify(fixture.prefix)}) {
      localStorage.clear();
      localStorage.setItem('fractalmind.app.public-connection.v1', ${JSON.stringify(JSON.stringify(connection))});
      localStorage.setItem('fractalmind.app.device-connection.v1', ${JSON.stringify(JSON.stringify(device))});
      localStorage.setItem('fm-ui-fixture', ${JSON.stringify(fixture.prefix)});
    }
    Object.defineProperty(globalThis, 'isTauri', { value: true, configurable: true });
    globalThis.__TAURI_INTERNALS__ = {
      invoke: async (command, args = {}) => {
        const response = await fetch('/invoke', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ command, args }) });
        const body = await response.json();
        if (!response.ok || !body.ok) throw new Error(body.error || 'native bridge failed');
        return body.result;
      },
      transformCallback: () => 0, unregisterCallback: () => {}, convertFileSrc: () => '',
      metadata: { currentWindow: { label: 'main' }, currentWebview: { windowLabel: 'main', label: 'main' } },
    };
  })();</script>`;
  const status = (profile: string) => {
    native(profile, "public");
    return { profile, unlocked: true, idleTimeoutMs: 15 * 60_000, remainingMs: 15 * 60_000 };
  };
  const log: string[] = [];
  async function answer(command: string, args: Record<string, string>) {
    const profile = args.profile;
    if (profile !== undefined) assert.ok(profile.startsWith(`${fixture.prefix}-`), `profile ${profile} is not this fixture's`);
    switch (command) {
      case "fm_device_session":
      case "fm_device_touch":
        return status(profile);
      case "fm_device_unlock":
      case "fm_device_public":
        return native(profile, "public");
      case "fm_device_initialize":
        return native(profile, "initialize");
      case "fm_device_sign_transaction":
        return native(profile, "signTransaction", { bytes: args.bytes });
      case "fm_device_prove":
        return native(profile, "proveDevice", { challenge: args.challenge });
      case "fm_device_wrap_organization_keys":
        return native(profile, "wrapOrganizationKeys", { record: args.request });
      case "fm_device_encrypt_record":
        return native(profile, "encryptRecord", { record: args.record });
      case "fm_device_decrypt_record":
        return native(profile, "decryptRecord", { record: args.record });
      case "fm_recovery_import":
        return native(profile, "importRecovery", { network: args.network, code: args.code });
      case "fm_recovery_imported_public":
        return native(profile, "publicImportedRecovery", { network: args.network });
      case "fm_recovery_prepare":
        return native(profile, "prepareRecovery", { network: args.network, source: args.source });
      case "fm_recovery_prepared_public":
        return native(profile, "publicPreparedRecovery", { network: args.network });
      case "fm_recovery_sign_transaction":
        return native(profile, "signRecovery", { network: args.network, phase: args.phase, bytes: args.bytes });
      case "fm_device_set_idle_timeout":
        return Number(args.ms ?? 0);
      case "fm_device_lock":
      case "fm_app_appearance":
        return null;
      default:
        throw new Error(`bridge does not expose ${command}`);
    }
  }
  const types: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json", ".woff2": "font/woff2", ".ico": "image/x-icon" };
  createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (request.method === "POST" && url.pathname === "/invoke") {
      let body = "";
      for await (const chunk of request) body += chunk;
      const value = JSON.parse(body);
      try {
        const result = await answer(value.command, value.args ?? {});
        log.push(`${new Date().toISOString()} ok ${value.command}`);
        response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ok: true, result }));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log.push(`${new Date().toISOString()} ERR ${value.command}: ${message}`);
        console.log(`bridge ${value.command}: ${message}`);
        response.writeHead(500, { "content-type": "application/json" }).end(JSON.stringify({ ok: false, error: message }));
      }
      return;
    }
    if (url.pathname === "/__bridge-log") return response.writeHead(200, { "content-type": "text/plain" }).end(log.join("\n"));
    const path = url.pathname === "/" ? "/index.html" : url.pathname;
    const file = resolve(join(dist, path));
    if (!file.startsWith(dist)) return response.writeHead(403).end();
    try {
      let data: Buffer | string = await readFile(file);
      if (path === "/index.html") data = data.toString("utf8").replace("<head>", `<head>${bootstrap}`);
      response.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream" }).end(data);
    } catch {
      response.writeHead(404).end();
    }
  }).listen(4189, "127.0.0.1", () => step("serving the App on http://127.0.0.1:4189 (signed in as device B)"));
}

if (mode === "sweep") {
  const fixture = JSON.parse(await readFile(fixturePath, "utf8")) as Fixture & { extraProfiles?: string[] };
  const { stdout } = await execFile("sui", ["client", "active-address"]);
  const to = stdout.trim();
  const recovery = recoveryKeys(fixture.recoveryCode, "testnet");
  const targets: Array<[string, string, Signer]> = [
    ["A", fixture.addresses.a, helperSigner(fixture.profiles.a)],
    ["B", fixture.addresses.b, helperSigner(fixture.profiles.b)],
    ["recovery", recovery.address, async (bytes) => (await recovery.signer.signTransaction(bytes)).signature],
  ];
  for (const profile of fixture.extraProfiles ?? []) targets.push([profile, native(profile, "public").address, helperSigner(profile)]);
  for (const [name, address, sign] of targets) {
    try {
      const moved = await sweep(address, sign, to);
      step(`${name}: returned ${Number(moved) / 1e9} SUI`);
    } catch (error) {
      step(`${name}: ${(error as Error).message.slice(0, 160)}`);
    }
  }
}
