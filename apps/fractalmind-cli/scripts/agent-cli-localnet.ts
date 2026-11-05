/** Local-only P1 acceptance: publishes a fresh zero-address build, creates a
 * Human and organization, pairs an Agent with READ, then proves revocation.
 * Usage: npm run localnet -- /absolute/path/to/zero-address-bytecode.json
 */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

await requestSuiFromFaucetV2({ host: faucet, recipient: rootAddress });
const bytecode = JSON.parse(await readFile(bytecodePath, 'utf8'));
const publish = new Transaction(); const [upgradeCap] = publish.publish(bytecode); publish.transferObjects([upgradeCap], rootAddress);
const publishData = await execute(publish, root);
const packageId = publishData.effects!.changedObjects.find(change => change.outputState === 'PackageWrite')!.objectId;
const registryId = created(publishData, '::organization::ProtocolRegistry');
const sdk = new FractalMindSDK({ packageId, registryId, network: 'localnet', client });
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
await writeFile(deploymentPath, JSON.stringify({ network: 'localnet', packageId, registryId, fullnodeUrl: rpc }), { mode: 0o600 });
const previous = { FM_CONFIG_DIR: process.env.FM_CONFIG_DIR, FM_KEY_PASSPHRASE: process.env.FM_KEY_PASSPHRASE, FM_LOCALNET_FAUCET: process.env.FM_LOCALNET_FAUCET };
process.env.FM_CONFIG_DIR = sandbox; process.env.FM_KEY_PASSPHRASE = 'localnet-only-acceptance-passphrase'; process.env.FM_LOCALNET_FAUCET = faucet;
const cliErrors: string[] = [];
const silent = { out: () => {}, err: (line: string) => cliErrors.push(line) };
try {
  const loginCode = await run(['auth', 'login', '--org', organizationId, '--network', 'localnet', '--deployment', deploymentPath, '--faucet', '--no-wait', '--json'], silent);
  assert.equal(loginCode, 0, `agent pairing request should publish: ${cliErrors.join('')} (package=${packageId}, registry=${registryId}, identityRegistry=${identityRegistryId}, human=${humanId}, org=${organizationId})`);
  const profile = JSON.parse(await readFile(join(sandbox, 'profile-localnet.json'), 'utf8')) as { requestId: string; grantId?: string; address: string };
  const clock = await client.core.getObject({ objectId: '0x6', include: { content: true } });
  const now = BigInt(bcs.struct('Clock', { id: bcs.Address, timestamp_ms: bcs.u64() }).parse(clock.object.content!).timestamp_ms);
  await execute(sdk.identity.approveAgentOperator({ identityRegistryId, humanId, grantId: rootGrantId, requestId: profile.requestId, organizationId, actions: ['read'], expiresAtMs: now + 86_400_000n, label: 'localnet CLI' }), root);
  assert.equal(await run(['auth', 'status', '--network', 'localnet', '--json'], silent), 0, `approval should be visible to CLI: ${cliErrors.join('')}`);
  assert.equal(await run(['org', 'show', '--network', 'localnet', '--json'], silent), 0, `READ Agent can show organization: ${cliErrors.join('')}`);
  assert.equal(await run(['okr', 'list', '--network', 'localnet', '--json'], silent), 0, `READ Agent can list OKRs: ${cliErrors.join('')}`);
  const granted = JSON.parse(await readFile(join(sandbox, 'profile-localnet.json'), 'utf8')) as { grantId: string };
  await execute(sdk.identity.revokeDevice({ humanId, grantId: rootGrantId, targetGrantId: granted.grantId }), root);
  assert.equal(await run(['org', 'show', '--network', 'localnet', '--json'], silent), 5, 'revoked Agent must be denied on the next fresh read');
  console.log(JSON.stringify({ status: 'PASS', checks: ['pair', 'approve READ', 'org show', 'okr list', 'revocation'] }));
} finally {
  contentKey.fill(0); keyring.fill(0); recovery.encryptionSecret.fill(0); device.secret.fill(0);
  if (previous.FM_CONFIG_DIR === undefined) delete process.env.FM_CONFIG_DIR; else process.env.FM_CONFIG_DIR = previous.FM_CONFIG_DIR;
  if (previous.FM_KEY_PASSPHRASE === undefined) delete process.env.FM_KEY_PASSPHRASE; else process.env.FM_KEY_PASSPHRASE = previous.FM_KEY_PASSPHRASE;
  if (previous.FM_LOCALNET_FAUCET === undefined) delete process.env.FM_LOCALNET_FAUCET; else process.env.FM_LOCALNET_FAUCET = previous.FM_LOCALNET_FAUCET;
  await rm(sandbox, { recursive: true, force: true });
}
