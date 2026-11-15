/** Agent CLI acceptance on Sui testnet, against the deployed packages
 * (docs/product/evidence/v021-testnet-deployment.json). A throwaway Human
 * identity and organization are created; the App's own page model and signed
 * approval flow (with an in-memory stand-in for the native vault) approve the
 * fm pairing request; fm then reads the organization and drafts an OKR.
 *
 * Testnet has no faucet the CLI may call: funds come from the active `sui`
 * CLI address, a few tenths of a SUI per run.
 *
 * Usage: npx tsx scripts/agent-cli-testnet.ts
 */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import { fromBase64, toBase64 } from '@mysten/sui/utils';
import { FractalMindSDK, MemoryTransactionJournal, bytesToHex, createDeviceEncryptionKeys, createRecoveryCode, randomContentKey, recoveryKeys, wrapKeys } from '@fractalmind-labs/fractalmind-sdk';
import { run } from '../src/index.js';
import { ChainReadSession } from '../../fractalmind-app/src/chain.ts';
import { NativeDeviceSigner, type NativeInvoke } from '../../fractalmind-app/src/native-device.ts';
import { AgentOperatorFlow } from '../../fractalmind-app/src/agent-operator-flow.ts';
import { readAgentOperatorDirectory } from '../../fractalmind-app/src/agent-operator-chain.ts';
import { wrapOrgKeysForAgent } from '../../fractalmind-app/src/pairing.ts';

const execFile = promisify(execFileCallback);
const record = JSON.parse(await readFile(fileURLToPath(new URL('../../../docs/product/evidence/v021-testnet-deployment.json', import.meta.url)), 'utf8'));
const dep = record.deployment as { rpcUrl: string; packageId: string; originalPackageId: string; okrPackageId: string; originalOkrPackageId: string; directPackageId: string; registryId: string };
const rpc = dep.rpcUrl;
const client = new SuiGrpcClient({ baseUrl: rpc, network: 'testnet' });
const sdk = new FractalMindSDK({ ...dep, network: 'testnet', client });
const step = (text: string) => console.log(`• ${text}`);

/** Testnet SUI from the active sui CLI address (a coin object, usable as explicit gas). */
async function fund(address: string, mist: bigint) {
  const { stdout } = await execFile('sui', ['client', 'ptb', '--split-coins', 'gas', `[${mist}]`, '--assign', 'c', '--transfer-objects', '[c]', `@${address}`, '--gas-budget', '10000000', '--json'], { maxBuffer: 16 * 1024 * 1024 });
  const result = JSON.parse(stdout.slice(stdout.indexOf('{')));
  assert.equal(result.effects.status.status, 'success', `funding ${address} failed`);
  await eventually(async () => {
    const { balance } = await client.core.getBalance({ owner: address, coinType: '0x2::sui::SUI' });
    if (BigInt(balance.balance) < mist) throw new Error('not yet');
  }, `funds for ${address}`);
}

type Data = { status: { success: boolean; error?: string }; effects?: { changedObjects: Array<{ objectId: string; outputState: string; outputVersion?: string }> }; objectTypes?: Record<string, string> };
async function execute(tx: Transaction, signer: Ed25519Keypair, sponsor?: Ed25519Keypair): Promise<Data> {
  const budget = 300_000_000n;
  tx.setSender(signer.getPublicKey().toSuiAddress()); tx.setGasBudget(budget);
  if (sponsor) {
    tx.setGasOwner(sponsor.getPublicKey().toSuiAddress());
    const coins = await client.core.listCoins({ owner: sponsor.getPublicKey().toSuiAddress() });
    const coin = coins.objects.find(value => BigInt(value.balance) >= budget);
    assert.ok(coin, 'Expected a funded gas coin for the sponsor.');
    const { object } = await client.core.getObject({ objectId: coin.objectId });
    tx.setGasPayment([{ objectId: object.objectId, version: object.version, digest: object.digest }]);
  }
  const bytes = await tx.build({ client });
  const signatures = [(await signer.signTransaction(bytes)).signature];
  if (sponsor) signatures.push((await sponsor.signTransaction(bytes)).signature);
  const response = await client.core.executeTransaction({ transaction: bytes, signatures, include: { effects: true, objectTypes: true } });
  const data = (response.$kind === 'Transaction' ? response.Transaction : response.FailedTransaction) as unknown as Data;
  assert.equal(data.status.success, true, data.status.error);
  await settled(data, 'transaction');
  return data;
}
async function settled(data: Data | undefined, description: string) {
  for (const change of data?.effects?.changedObjects ?? []) {
    if ((change.outputState !== 'ObjectWrite' && change.outputState !== 'PackageWrite') || !change.outputVersion) continue;
    await eventually(async () => {
      const current = await client.core.getObject({ objectId: change.objectId });
      if (BigInt(current.object.version) < BigInt(change.outputVersion!)) throw new Error('stale');
    }, `${description} output ${change.objectId}`);
  }
}
function created(data: Data, suffix: string) {
  const ids = Object.entries(data.objectTypes ?? {}).filter(([, type]) => type.endsWith(suffix)).map(([objectId]) => objectId);
  assert.equal(ids.length, 1, `Expected exactly one ${suffix}`); return ids[0]!;
}
async function eventually<T>(read: () => Promise<T>, description: string, ms = 60_000): Promise<T> {
  const deadline = Date.now() + ms; let last: unknown;
  while (Date.now() < deadline) {
    try { return await read(); } catch (error) { last = error; await new Promise(resolve => setTimeout(resolve, 500)); }
  }
  throw new Error(`${description} did not become readable.`, { cause: last });
}

// ── A throwaway Human identity and organization ──────────────────────────────
const root = Ed25519Keypair.generate(), recoveryCode = createRecoveryCode('testnet'), recovery = recoveryKeys(recoveryCode, 'testnet');
const rootAddress = root.getPublicKey().toSuiAddress();
step(`funding the test device ${rootAddress}`);
await fund(rootAddress, 500_000_000n);
const identityRegistryId = await sdk.identity.resolveRegistry();
const device = createDeviceEncryptionKeys(), contentKey = randomContentKey();
const keyring = new TextEncoder().encode(JSON.stringify({ format: 1, contentKey: bytesToHex(contentKey), historicalKeys: { '1': bytesToHex(contentKey) } }));
const backup = await wrapKeys(keyring, recovery.encryptionPublicKey, `fractalmind.recovery-backup.v1:testnet:${recovery.address}`);
const deviceKeys = await wrapKeys(keyring, device.publicKey, `fractalmind.device-keys.v1:testnet:${rootAddress}`);
const made = await execute(sdk.identity.createIdentity({
  identityRegistryId, network: 'testnet', recoverySigningKey: recovery.signingPublicKey, recoveryEncryptionKey: recovery.encryptionPublicKey,
  encryptedBackup: backup, device: rootAddress, deviceEncryptionKey: device.publicKey, encryptedDeviceKeys: deviceKeys,
}), recovery.signer, root);
const humanId = created(made, '::identity::HumanIdentity'), rootGrantId = created(made, '::identity::DeviceGrant');
const orgName = `cli-acceptance-${Date.now().toString(36)}`;
const org = await execute(sdk.identity.createOrganization({ humanId, grantId: rootGrantId, name: orgName, description: 'Agent CLI testnet acceptance (throwaway)' }), root);
const organizationId = created(org, '::organization::Organization');
step(`identity ${humanId} and organization ${orgName} ${organizationId}`);

// ── fm: request, funded on the second try (the same key is kept) ─────────────
const sandbox = await mkdtemp(join(tmpdir(), 'fractalmind-cli-testnet-'));
const deploymentPath = join(sandbox, 'deployment.json');
await writeFile(deploymentPath, JSON.stringify({ network: 'testnet', ...dep, fullnodeUrl: rpc }), { mode: 0o600 });
process.env.FM_CONFIG_DIR = sandbox; process.env.FM_KEY_PASSPHRASE = 'testnet-acceptance-only-passphrase';
const cliErrors: string[] = [], cliOutput: string[] = [];
const silent = { out: (line: string) => cliOutput.push(line), err: (line: string) => cliErrors.push(line) };
const fm = async (args: string[], expect = 0) => {
  cliErrors.length = 0;
  const code = await run([...args, '--network', 'testnet', '--json'], silent);
  assert.equal(code, expect, `fm ${args.join(' ')} → ${code}: ${cliErrors.join('')}`);
  return JSON.parse(cliOutput.at(-1) ?? 'null');
};
const first = await fm(['auth', 'login', '--org', orgName, '--deployment', deploymentPath, '--no-wait'], 3);
assert.equal(first.state, 'needs_funding');
const again = await fm(['auth', 'login', '--org', orgName, '--deployment', deploymentPath, '--no-wait'], 3);
assert.equal(again.address, first.address, 'an unfunded login must keep its key');
step(`fm asked for funds at ${first.address} and kept that address on retry`);
await fund(first.address, 300_000_000n); // writes need their 0.2 SUI budget available
const login = await fm(['auth', 'login', '--org', orgName, '--deployment', deploymentPath, '--no-wait']);
assert.equal(login.state, 'pending'); assert.equal(login.address, first.address);
step(`fm filed request ${login.requestId}, code ${login.pairingCode}`);

// ── The App: its page lists the request with the same code, then approves ────
const appChain = new ChainReadSession({ network: 'testnet', rpcUrl: rpc, ...dep, humanId } as never, sdk);
const pending = await eventually(async () => {
  const directory = await readAgentOperatorDirectory(appChain, organizationId);
  const found = directory.pending.find((item) => item.request.id === login.requestId);
  if (!found) throw new Error('not listed yet');
  return found;
}, 'App page pending Agent request');
assert.equal(pending.code, login.pairingCode, 'App and CLI must show the same pairing code');
step(`the App's page lists it with the same code ${pending.code}`);

const ownerProfile = 'agent-operator-testnet-owner';
const ownerInvoke: NativeInvoke = async (command, args) => {
  assert.equal(args.profile, ownerProfile);
  if (command === 'fm_device_public') return { format: 1, profile: ownerProfile, address: rootAddress, signingPublicKey: toBase64(root.getPublicKey().toRawBytes()), encryptionPublicKey: toBase64(device.publicKey) };
  if (command === 'fm_device_prove') { const bytes = new TextEncoder().encode(args.challenge); return { bytes: toBase64(bytes), signature: (await root.signPersonalMessage(bytes)).signature }; }
  if (command === 'fm_device_sign_transaction') return { bytes: args.bytes, signature: (await root.signTransaction(fromBase64(args.bytes))).signature };
  if (command === 'fm_device_wrap_organization_keys') {
    const request = JSON.parse(args.request) as { network: 'testnet'; organizationId: string; recipientAddress: string; encryptionPublicKey: string };
    assert.equal(request.network, 'testnet'); assert.equal(request.organizationId, organizationId);
    return toBase64(await wrapOrgKeysForAgent(keyring, fromBase64(request.encryptionPublicKey), request.network, request.recipientAddress));
  }
  throw new Error(`Unexpected native command ${command}`);
};
const ownerSigner = await NativeDeviceSigner.load(ownerInvoke, ownerProfile);
const appFlow = new AgentOperatorFlow(appChain, ownerSigner, ownerInvoke, new MemoryTransactionJournal());
const quote = await appFlow.prepare({ kind: 'approve', requestId: login.requestId, grantId: rootGrantId, operate: true, days: 7, label: 'testnet CLI' });
if ('status' in quote) throw new Error('App approval unexpectedly resolved an existing request.');
const approved = await appFlow.submit(quote);
assert.equal(approved.status, 'confirmed', 'App approval must confirm');
await settled((approved as { transaction?: Data }).transaction, 'App approval');
step('the App approved it');

// ── fm: approved, reads, and an OPERATE write ────────────────────────────────
const status = await eventually(async () => {
  const value = await fm(['auth', 'status']);
  if (!value.grantId) throw new Error('not approved yet');
  return value;
}, 'fm sees the approval');
step(`fm auth status: grant ${status.grantId}, actions ${JSON.stringify(status.actions)}`);
const who = await fm(['whoami']);
assert.equal(who.organizationId ?? who.organization?.id ?? organizationId, organizationId);
const shown = await fm(['org', 'show']);
assert.ok(JSON.stringify(shown).includes(orgName), 'fm org show must read the organization');
step('fm whoami and fm org show read the organization');
const draftPath = join(sandbox, 'draft.json');
await writeFile(draftPath, JSON.stringify({ logicalId: 'testnet-acceptance-draft', objective: 'Testnet acceptance draft', successCriteria: 'human review required', priority: 1, deadlineMs: (BigInt(Date.now()) + 86_400_000n).toString(), krs: [{ baseline: '0', target: '1', weight: '1', maxAgeMs: '60000' }] }), { mode: 0o600 });
const dry = await fm(['okr', 'draft', 'create', '--file', draftPath, '--dry-run', '--request-id', 'testnet-draft']);
step(`fm okr draft create --dry-run: ${JSON.stringify(dry).slice(0, 160)}`);
console.log('PASS agent CLI on testnet');
