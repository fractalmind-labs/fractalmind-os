/** Local-only P0b acceptance: publishes a fresh zero-address build, creates a
 * Human and organization, approves an Agent with its wrapped organization
 * keyring, then proves its two bounded OPERATE writers and revocation gates.
 * Usage: npm run localnet -- /absolute/path/to/zero-address-bytecode.json
 */
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { requestSuiFromFaucetV2 } from '@mysten/sui/faucet';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import { bcs } from '@mysten/sui/bcs';
import { FractalMindSDK, bytesToHex, createDeviceEncryptionKeys, createRecoveryCode, randomContentKey, recoveryKeys, wrapKeys } from '@fractalmind-labs/fractalmind-sdk';
import { run } from '../src/index.js';

const bytecodePath = process.argv[2];
assert.ok(bytecodePath, 'Pass the bytecode JSON built from a zero-address local test copy.');
const rpc = process.env.FM_LOCALNET_RPC ?? 'http://127.0.0.1:9000';
const faucet = process.env.FM_LOCALNET_FAUCET ?? 'http://127.0.0.1:9123';
for (const endpoint of [rpc, faucet]) assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(endpoint).hostname), 'This acceptance only uses localhost localnet.');
const client = new SuiGrpcClient({ baseUrl: rpc, network: 'localnet' });
const root = Ed25519Keypair.generate(), recoveryCode = createRecoveryCode('localnet'), recovery = recoveryKeys(recoveryCode, 'localnet');
const rootAddress = root.getPublicKey().toSuiAddress();
const execFile = promisify(execFileCallback);

type Data = { status: { success: boolean; error?: string }; effects?: { changedObjects: Array<{ objectId: string; outputState: string; outputVersion?: string }> }; objectTypes?: Record<string, string> };
async function execute(tx: Transaction, signer: Ed25519Keypair, sponsor?: Ed25519Keypair): Promise<Data> {
  tx.setSender(signer.getPublicKey().toSuiAddress()); tx.setGasBudget(2_000_000_000);
  if (sponsor) tx.setGasOwner(sponsor.getPublicKey().toSuiAddress());
  await tx.build({ client, onlyTransactionKind: true });
  const payer = sponsor ?? signer;
  const coins = await client.core.listCoins({ owner: payer.getPublicKey().toSuiAddress() });
  const coin = coins.objects.find(value => BigInt(value.balance) >= 2_000_000_000n);
  assert.ok(coin, 'Expected a funded localnet gas coin.');
  const { object } = await client.core.getObject({ objectId: coin.objectId });
  tx.setGasPayment([{ objectId: object.objectId, version: object.version, digest: object.digest }]);
  tx.setGasPrice((await client.core.getReferenceGasPrice()).referenceGasPrice);
  const bytes = await tx.build({ client });
  const signatures = [(await signer.signTransaction(bytes)).signature];
  if (sponsor) signatures.push((await sponsor.signTransaction(bytes)).signature);
  const response = await client.core.executeTransaction({ transaction: bytes, signatures, include: { effects: true, objectTypes: true } });
  const data = (response.$kind === 'Transaction' ? response.Transaction : response.FailedTransaction) as unknown as Data;
  assert.equal(data.status.success, true, data.status.error);
  // gRPC can return transaction effects just ahead of the simulator's object
  // cache. Confirm every write before using it as a subsequent PTB input.
  for (const change of data.effects?.changedObjects ?? []) {
    if (change.outputState !== 'ObjectWrite' && change.outputState !== 'PackageWrite') continue;
    const deadline = Date.now() + 20_000;
    while (true) {
      try {
        const current = await client.core.getObject({ objectId: change.objectId });
        if (!change.outputVersion || BigInt(current.object.version) >= BigInt(change.outputVersion)) break;
      } catch { /* The next short retry is the evidence, not a resubmission. */ }
      assert.ok(Date.now() < deadline, `Output ${change.objectId} did not become readable.`);
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  return data;
}
function created(data: Data, suffix: string) {
  const ids = Object.entries(data.objectTypes ?? {}).filter(([, type]) => type.endsWith(suffix)).map(([objectId]) => objectId);
  assert.equal(ids.length, 1, `Expected exactly one ${suffix}`); return ids[0]!;
}
async function eventually<T>(read: () => Promise<T>, description: string): Promise<T> {
  const deadline = Date.now() + 20_000; let last: unknown;
  while (Date.now() < deadline) {
    try { return await read(); } catch (error) { last = error; await new Promise(resolve => setTimeout(resolve, 100)); }
  }
  throw new Error(`${description} did not become readable.`, { cause: last });
}

/** The protocol must be published before its separately-addressed OKR package.
 * Build an ephemeral OKR source tree pinned to this exact fresh protocol ID;
 * this is local build metadata only and never touches the checkout. */
async function buildOkrBytecode(protocolPackageId: string) {
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  const protocolSource = join(root, 'protocols/fractalmind-protocol/contracts/protocol');
  const okrSource = join(root, 'protocols/fractalmind-protocol/contracts/okr');
  const buildRoot = await mkdtemp(join(tmpdir(), 'fractalmind-cli-okr-build-'));
  try {
    await cp(protocolSource, join(buildRoot, 'protocol'), { recursive: true });
    await cp(okrSource, join(buildRoot, 'okr'), { recursive: true });
    const manifestPath = join(buildRoot, 'protocol', 'Move.toml');
    const manifest = await readFile(manifestPath, 'utf8');
    await writeFile(manifestPath, manifest
      .replace(/^published-at\s*=.*$/m, `published-at = "${protocolPackageId}"`)
      .replace(/^fractalmind_protocol\s*=.*$/m, `fractalmind_protocol = "${protocolPackageId}"`));
    const sui = process.env.SUI_BIN ?? join(process.env.HOME ?? '', '.local/sui-1.83/bin/sui');
    const { stdout } = await execFile(sui, ['move', 'build', '--path', join(buildRoot, 'okr'), '--no-tree-shaking', '--dump-bytecode-as-base64'], { maxBuffer: 32 * 1024 * 1024 });
    return JSON.parse(stdout);
  } finally { await rm(buildRoot, { recursive: true, force: true }); }
}

await requestSuiFromFaucetV2({ host: faucet, recipient: rootAddress });
const bytecode = JSON.parse(await readFile(bytecodePath, 'utf8'));
const publish = new Transaction(); const [upgradeCap] = publish.publish(bytecode); publish.transferObjects([upgradeCap], rootAddress);
const publishData = await execute(publish, root);
const packageId = publishData.effects!.changedObjects.find(change => change.outputState === 'PackageWrite')!.objectId;
const registryId = created(publishData, '::organization::ProtocolRegistry');
const okrBytecode = await buildOkrBytecode(packageId);
const publishOkr = new Transaction(); const [okrUpgradeCap] = publishOkr.publish(okrBytecode); publishOkr.transferObjects([okrUpgradeCap], rootAddress);
const okrPublishData = await execute(publishOkr, root);
const okrPackageId = okrPublishData.effects!.changedObjects.find(change => change.outputState === 'PackageWrite')!.objectId;
const sdk = new FractalMindSDK({ packageId, registryId, okrPackageId, network: 'localnet', client });
// Fresh bootstrap initialization creates the identity registry atomically.
// `initialize_registry` remains only for upgrading old deployments.
const identityRegistryId = await sdk.identity.resolveRegistry();
const device = createDeviceEncryptionKeys(), contentKey = randomContentKey();
const keyring = new TextEncoder().encode(JSON.stringify({ format: 1, contentKey: bytesToHex(contentKey), historicalKeys: { '1': bytesToHex(contentKey) } }));
const backup = await wrapKeys(keyring, recovery.encryptionPublicKey, `fractalmind.recovery-backup.v1:localnet:${recovery.address}`);
const deviceKeys = await wrapKeys(keyring, device.publicKey, `fractalmind.device-keys.v1:localnet:${rootAddress}`);
const made = await execute(sdk.identity.createIdentity({
  identityRegistryId, network: 'localnet', recoverySigningKey: recovery.signingPublicKey, recoveryEncryptionKey: recovery.encryptionPublicKey,
  encryptedBackup: backup, device: rootAddress, deviceEncryptionKey: device.publicKey, encryptedDeviceKeys: deviceKeys,
}), recovery.signer, root);
const humanId = created(made, '::identity::HumanIdentity'), rootGrantId = created(made, '::identity::DeviceGrant');
const org = await execute(sdk.identity.createOrganization({ humanId, grantId: rootGrantId, name: `CLI acceptance ${Date.now()}`, description: 'localnet-only Agent CLI acceptance' }), root);
const organizationId = created(org, '::organization::Organization');

const sandbox = await mkdtemp(join(tmpdir(), 'fractalmind-cli-localnet-'));
const deploymentPath = join(sandbox, 'deployment.json');
const draftPath = join(sandbox, 'draft.json');
await writeFile(deploymentPath, JSON.stringify({ network: 'localnet', packageId, registryId, okrPackageId, fullnodeUrl: rpc }), { mode: 0o600 });
await writeFile(draftPath, JSON.stringify({
  logicalId: 'agent-localnet-draft', objective: 'P0b localnet draft', successCriteria: 'human review required',
  priority: 1, deadlineMs: (BigInt(Date.now()) + 86_400_000n).toString(),
  krs: [{ baseline: '0', target: '1', weight: '1', maxAgeMs: '60000' }],
}), { mode: 0o600 });
const previous = { FM_CONFIG_DIR: process.env.FM_CONFIG_DIR, FM_KEY_PASSPHRASE: process.env.FM_KEY_PASSPHRASE, FM_LOCALNET_FAUCET: process.env.FM_LOCALNET_FAUCET };
process.env.FM_CONFIG_DIR = sandbox; process.env.FM_KEY_PASSPHRASE = 'localnet-only-acceptance-passphrase'; process.env.FM_LOCALNET_FAUCET = faucet;
const cliErrors: string[] = [], cliOutput: string[] = [];
const silent = { out: (line: string) => cliOutput.push(line), err: (line: string) => cliErrors.push(line) };
try {
  const loginCode = await run(['auth', 'login', '--org', organizationId, '--network', 'localnet', '--deployment', deploymentPath, '--faucet', '--no-wait', '--json'], silent);
  assert.equal(loginCode, 0, `agent pairing request should publish: ${cliErrors.join('')} (package=${packageId}, registry=${registryId}, identityRegistry=${identityRegistryId}, human=${humanId}, org=${organizationId})`);
  const profile = JSON.parse(await readFile(join(sandbox, 'profile-localnet.json'), 'utf8')) as { requestId: string; grantId?: string; address: string };
  const clock = await client.core.getObject({ objectId: '0x6', include: { content: true } });
  const now = BigInt(bcs.struct('Clock', { id: bcs.Address, timestamp_ms: bcs.u64() }).parse(clock.object.content!).timestamp_ms);
  const request = await sdk.identity.getDevicePairing(profile.requestId);
  const agentKeys = await wrapKeys(keyring, Uint8Array.from(request.encryption_public_key), `fractalmind.device-keys.v1:localnet:${profile.address}`);
  await execute(sdk.identity.approveAgentOperator({
    identityRegistryId, humanId, grantId: rootGrantId, requestId: profile.requestId, organizationId,
    actions: ['read', 'operate'], expiresAtMs: now + 86_400_000n, encryptedKeys: agentKeys, label: 'localnet CLI',
  }), root);
  assert.equal(await run(['auth', 'status', '--network', 'localnet', '--json'], silent), 0, `approval should be visible to CLI: ${cliErrors.join('')}`);
  const granted = JSON.parse(await readFile(join(sandbox, 'profile-localnet.json'), 'utf8')) as { grantId: string };
  assert.ok((await sdk.identity.getDeviceGrant(granted.grantId)).encrypted_keys.length > 0, 'approved Agent must receive its wrapped keyring');
  assert.equal(await run(['okr', 'draft', 'create', '--network', 'localnet', '--file', draftPath, '--request-id', 'p0b-draft', '--json'], silent), 0, `OPERATE Agent should create a draft: ${cliErrors.join('')}`);
  const listed = await eventually(() => sdk.okr.listOkrs(organizationId, null, 50), 'draft directory');
  assert.equal(listed.okrs.length, 1, 'draft must appear in the OKR directory');
  const draft = listed.okrs[0]!;
  assert.equal(await run(['okr', 'show', draft.id, '--network', 'localnet', '--json'], silent), 0, `Agent should decrypt its OKR spec: ${cliErrors.join('')}`);
  const shown = JSON.parse(cliOutput.at(-1)!) as { spec?: { objective?: string } };
  assert.equal(shown.spec?.objective, 'P0b localnet draft', 'fm okr show must decrypt the encrypted draft content');
  assert.equal(await run(['approval', 'request', 'okr.activate', '--title', 'Review draft', '--body', 'Human approval required.', '--ref', draft.id, '--network', 'localnet', '--request-id', 'p0b-approval', '--json'], silent), 0, `OPERATE Agent should file an approval request: ${cliErrors.join('')}`);
  const approval = await eventually(async () => {
    const directory = await sdk.productRecord.listCurrent(organizationId, null, 50);
    const found = directory.records.find(record => record.kind === 3 && record.logicalId.startsWith('agent-request:'));
    if (!found) throw new Error('approval request is not yet in the product-record directory');
    return found;
  }, 'approval request');
  assert.equal(await run(['approval', 'show', approval.record_id, '--network', 'localnet', '--json'], silent), 0, `Agent should decrypt its approval request: ${cliErrors.join('')}`);
  const humanRead = await sdk.productRecord.decryptRecord(approval.record_id, contentKey);
  try {
    const value = JSON.parse(new TextDecoder().decode(humanRead.plaintext)) as { title?: string; status?: string };
    assert.equal(value.title, 'Review draft'); assert.equal(value.status, 'pending');
  } finally { humanRead.plaintext.fill(0); }
  await execute(sdk.identity.changeDevicePermissions({ humanId, grantId: rootGrantId, targetGrantId: granted.grantId, organizationId, actions: ['read'], expiresAtMs: now + 86_400_000n }), root);
  assert.equal(await run(['approval', 'request', 'okr.activate', '--title', 'Denied by READ', '--body', 'No quote.', '--network', 'localnet', '--request-id', 'p0b-read-only'], silent), 4, 'READ-only Agent must not quote a writer');
  await execute(sdk.identity.revokeDevice({ humanId, grantId: rootGrantId, targetGrantId: granted.grantId }), root);
  assert.equal(await run(['org', 'show', '--network', 'localnet', '--json'], silent), 5, 'revoked Agent must be denied on the next fresh read');
  assert.equal(await run(['approval', 'request', 'okr.activate', '--title', 'Revoked', '--body', 'No transaction.', '--network', 'localnet', '--request-id', 'p0b-revoked'], silent), 5, 'revoked Agent must be denied on the next fresh write');
  console.log(JSON.stringify({ status: 'PASS', checks: ['pair', 'approve READ+OPERATE with wrapped keys', 'draft create', 'draft decrypt', 'approval request', 'human-side approval decrypt', 'READ-only write denied', 'revocation read denied', 'revocation write denied'] }));
} finally {
  contentKey.fill(0); keyring.fill(0); recovery.encryptionSecret.fill(0); device.secret.fill(0);
  if (previous.FM_CONFIG_DIR === undefined) delete process.env.FM_CONFIG_DIR; else process.env.FM_CONFIG_DIR = previous.FM_CONFIG_DIR;
  if (previous.FM_KEY_PASSPHRASE === undefined) delete process.env.FM_KEY_PASSPHRASE; else process.env.FM_KEY_PASSPHRASE = previous.FM_KEY_PASSPHRASE;
  if (previous.FM_LOCALNET_FAUCET === undefined) delete process.env.FM_LOCALNET_FAUCET; else process.env.FM_LOCALNET_FAUCET = previous.FM_LOCALNET_FAUCET;
  await rm(sandbox, { recursive: true, force: true });
}
