/** Local-only Agent CLI/App acceptance: publishes a fresh zero-address build,
 * creates a Human and organization, has the App model/flow approve an Agent
 * with its wrapped organization keyring, then proves bounded writes, activity,
 * renewal and revocation.
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
import { fromBase64, toBase64 } from '@mysten/sui/utils';
import { FractalMindSDK, MemoryTransactionJournal, bytesToHex, createDeviceEncryptionKeys, createRecoveryCode, randomContentKey, recoveryKeys, wrapKeys } from '@fractalmind-labs/fractalmind-sdk';
import { run } from '../src/index.js';
import { ChainReadSession } from '../../fractalmind-app/src/chain.ts';
import { NativeDeviceSigner, type NativeInvoke } from '../../fractalmind-app/src/native-device.ts';
import { AgentOperatorFlow } from '../../fractalmind-app/src/agent-operator-flow.ts';
import { readAgentOperatorDirectory } from '../../fractalmind-app/src/agent-operator-chain.ts';
import { agentActivityKind } from '../../fractalmind-app/src/agent-operators.ts';
import { wrapOrgKeysForAgent } from '../../fractalmind-app/src/pairing.ts';

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
/** A confirmed receipt can precede the read node's gas-object update. Do not
 * quote the next App action against that stale gas reference. */
async function waitForAppWrites(
  outcome: { status: string; transaction?: Data },
  description: string,
) {
  assert.equal(outcome.status, 'confirmed', `${description} must confirm`);
  for (const change of outcome.transaction?.effects?.changedObjects ?? []) {
    if (
      (change.outputState !== 'ObjectWrite' && change.outputState !== 'PackageWrite')
      || !change.outputVersion
    )
      continue;
    await eventually(async () => {
      const current = await client.core.getObject({ objectId: change.objectId });
      if (BigInt(current.object.version) < BigInt(change.outputVersion!))
        throw new Error(`${description} output is stale`);
      return current;
    }, `${description} output ${change.objectId}`);
  }
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
  const login = JSON.parse(cliOutput.at(-1)!) as { requestId?: string; pairingCode?: string; state?: string };
  const profile = JSON.parse(await readFile(join(sandbox, 'profile-localnet.json'), 'utf8')) as { requestId: string; grantId?: string; address: string };
  assert.equal(login.requestId, profile.requestId, 'CLI must report the stored pairing request');
  assert.equal(login.state, 'pending');
  const appChain = new ChainReadSession({
    network: 'localnet', rpcUrl: rpc, packageId, registryId, okrPackageId, humanId,
  }, sdk);
  const pending = await eventually(
    async () => {
      const directory = await readAgentOperatorDirectory(appChain, organizationId);
      const found = directory.pending.find((item) => item.request.id === profile.requestId);
      if (!found) throw new Error('App page model has not observed the CLI pairing request');
      return found;
    },
    'App page pending Agent request',
  );
  assert.equal(pending.code, login.pairingCode, 'App and CLI must show the same pairing code');

  // The flow is exercised with a local in-memory native bridge.  Its key
  // response uses the same pure helper as the desktop vault's scoped wrapper;
  // production keeps the owner keyring in the vault and never exposes it.
  const ownerProfile = 'agent-operator-e2e-owner';
  const ownerInvoke: NativeInvoke = async (command, args) => {
    assert.equal(args.profile, ownerProfile);
    if (command === 'fm_device_public') return {
      format: 1, profile: ownerProfile, address: rootAddress,
      signingPublicKey: toBase64(root.getPublicKey().toRawBytes()),
      encryptionPublicKey: toBase64(device.publicKey),
    };
    if (command === 'fm_device_prove') {
      const bytes = new TextEncoder().encode(args.challenge);
      const signed = await root.signPersonalMessage(bytes);
      return { bytes: toBase64(bytes), signature: signed.signature };
    }
    if (command === 'fm_device_sign_transaction') {
      const bytes = fromBase64(args.bytes);
      const signed = await root.signTransaction(bytes);
      return { bytes: args.bytes, signature: signed.signature };
    }
    if (command === 'fm_device_wrap_organization_keys') {
      const request = JSON.parse(args.request) as {
        network: 'localnet'; organizationId: string; recipientAddress: string;
        encryptionPublicKey: string; encryptedKeys: string;
      };
      assert.equal(request.network, 'localnet');
      assert.equal(request.organizationId, organizationId);
      assert.equal(request.recipientAddress, profile.address);
      assert.ok(request.encryptedKeys.length > 0, 'App flow must source the owner grant envelope');
      return toBase64(await wrapOrgKeysForAgent(
        keyring,
        fromBase64(request.encryptionPublicKey),
        request.network,
        request.recipientAddress,
      ));
    }
    throw new Error(`Unexpected native command ${command}`);
  };
  const ownerSigner = await NativeDeviceSigner.load(ownerInvoke, ownerProfile);
  const appFlow = new AgentOperatorFlow(
    appChain,
    ownerSigner,
    ownerInvoke,
    new MemoryTransactionJournal(),
  );
  const approvalQuote = await appFlow.prepare({
    kind: 'approve', requestId: profile.requestId, grantId: rootGrantId,
    operate: true, days: 7, label: 'localnet CLI',
  });
  if ('status' in approvalQuote)
    throw new Error('App approval unexpectedly resolved an existing request.');
  const approvalOutcome = await appFlow.submit(approvalQuote);
  assert.equal(approvalOutcome.status, 'confirmed', 'App approval must confirm');
  await waitForAppWrites(approvalOutcome, 'App approval');
  const grantedId = await eventually(
    () => appFlow.approvedGrantId(approvalOutcome),
    'App-approved Agent marker',
  );
  assert.equal(await run(['auth', 'status', '--network', 'localnet', '--json'], silent), 0, `approval should be visible to CLI: ${cliErrors.join('')}`);
  const granted = JSON.parse(await readFile(join(sandbox, 'profile-localnet.json'), 'utf8')) as { grantId: string };
  assert.equal(granted.grantId, grantedId, 'CLI must bind the grant approved by the App flow');
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
  const active = await eventually(
    async () => {
      const directory = await readAgentOperatorDirectory(appChain, organizationId);
      const found = directory.active.find((item) => item.grant.id === granted.grantId);
      if (!found || !found.activity.some((item) => item.function === 'okr::create_draft_by_agent')
        || !found.activity.some((item) => item.function === 'product_record::save_agent_request'))
        throw new Error('App page activity model has not observed both Agent writes');
      return found;
    },
    'App page Agent activity',
  );
  assert.equal(agentActivityKind(active.activity.find((item) => item.function === 'okr::create_draft_by_agent')!.function), 'draft_okr');
  assert.equal(agentActivityKind(active.activity.find((item) => item.function === 'product_record::save_agent_request')!.function), 'request_approval');
  const renewalQuote = await appFlow.prepare({
    kind: 'change', targetGrantId: granted.grantId, grantId: rootGrantId,
    operate: true, days: 30,
  });
  if ('status' in renewalQuote)
    throw new Error('App renewal unexpectedly resolved an existing request.');
  const renewalOutcome = await appFlow.submit(renewalQuote);
  assert.equal(renewalOutcome.status, 'confirmed', 'App renewal must confirm');
  await waitForAppWrites(renewalOutcome, 'App renewal');
  const renewed = await eventually(() => sdk.identity.getDeviceGrant(granted.grantId), 'renewed Agent grant');
  assert.ok(renewed.actions.includes(2), 'renewed grant keeps OPERATE');
  const revokeOperation = {
    kind: 'revoke', targetGrantId: granted.grantId, grantId: rootGrantId,
  } as const;
  const revokeQuote = await appFlow.prepare(revokeOperation);
  if ('status' in revokeQuote)
    throw new Error('App revocation unexpectedly resolved an existing request.');
  const revokeOutcome = await appFlow.submit(revokeQuote);
  assert.equal(revokeOutcome.status, 'confirmed', 'App revocation must confirm');
  await waitForAppWrites(revokeOutcome, 'App revocation');
  const revoked = await eventually(async () => {
    const grant = await sdk.identity.getDeviceGrant(granted.grantId);
    if (!grant.revoked) throw new Error('Agent grant is not revoked yet');
    return grant;
  }, 'revoked Agent grant');
  assert.equal(revoked.revoked, true);
  assert.equal(await run(['approval', 'request', 'okr.activate', '--title', 'Revoked', '--body', 'No transaction.', '--network', 'localnet', '--request-id', 'p0b-revoked'], silent), 5, 'revoked Agent must be denied on the next fresh write');
  console.log(JSON.stringify({ status: 'PASS', checks: ['CLI pairing', 'App pending model pairing code', 'App approval READ+OPERATE with wrapped keys', 'draft create', 'draft decrypt', 'approval request', 'App activity labels', 'App renew', 'App revoke', 'revocation write denied'] }));
} finally {
  contentKey.fill(0); keyring.fill(0); recovery.encryptionSecret.fill(0); device.secret.fill(0);
  if (previous.FM_CONFIG_DIR === undefined) delete process.env.FM_CONFIG_DIR; else process.env.FM_CONFIG_DIR = previous.FM_CONFIG_DIR;
  if (previous.FM_KEY_PASSPHRASE === undefined) delete process.env.FM_KEY_PASSPHRASE; else process.env.FM_KEY_PASSPHRASE = previous.FM_KEY_PASSPHRASE;
  if (previous.FM_LOCALNET_FAUCET === undefined) delete process.env.FM_LOCALNET_FAUCET; else process.env.FM_LOCALNET_FAUCET = previous.FM_LOCALNET_FAUCET;
  await rm(sandbox, { recursive: true, force: true });
}
