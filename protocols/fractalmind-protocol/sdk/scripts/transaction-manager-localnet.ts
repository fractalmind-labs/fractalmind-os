import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { requestSuiFromFaucetV2 } from '@mysten/sui/faucet';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import type { ClientWithCoreApi } from '@mysten/sui/client';
import { FractalMindSDK, SelfPayTransactionManager, MemoryTransactionJournal, TransactionPreflightError,
  createRecoveryCode, recoveryKeys, createDeviceEncryptionKeys, randomContentKey, wrapKeys, bytesToHex } from '../src/index.js';
import type { SelfPayTransactionData, SelfPayTransactionOutcome } from '../src/index.js';

const rpc = process.env.FM_LOCALNET_RPC ?? 'http://127.0.0.1:29000', faucet = process.env.FM_LOCALNET_FAUCET ?? 'http://127.0.0.1:29123';
for (const url of [rpc, faucet]) assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname), 'This test only spends isolated localnet SUI.');
assert.ok(process.argv[2] && process.argv[3], 'Pass a previous localnet deployment report and output report path.');
const deployment = JSON.parse(await readFile(process.argv[2], 'utf8'));
const client = new SuiGrpcClient({ baseUrl: rpc, network: 'localnet' });
assert.deepEqual(await client.core.getChainIdentifier(), deployment.chain, 'Deployment report must identify the running localnet.');
const sdk = new FractalMindSDK({ packageId: deployment.packageId, registryId: deployment.registryId, client, network: 'localnet' });
const code = createRecoveryCode('localnet'), recovery = recoveryKeys(code, 'localnet');
const desktop = Ed25519Keypair.generate(), phone = Ed25519Keypair.generate(), replacementPhone = Ed25519Keypair.generate();
const deviceKeys = createDeviceEncryptionKeys(), phoneKeys = createDeviceEncryptionKeys(), replacementKeys = createDeviceEncryptionKeys();
const contentKey = randomContentKey();
const keyring = new TextEncoder().encode(JSON.stringify({ format: 1, contentKey: bytesToHex(contentKey), historicalKeys: { '1': bytesToHex(contentKey) } }));
const backup = await wrapKeys(keyring, recovery.encryptionPublicKey, `fractalmind.recovery-backup.v1:localnet:${recovery.address}`);
const wrappedDesktop = await wrapKeys(keyring, deviceKeys.publicKey, `fractalmind.device-keys.v1:localnet:${desktop.toSuiAddress()}`);
const journal = new MemoryTransactionJournal();
let broadcasts = 0, digestQueries = 0, concealLedger = false, loseReceipt = false;
// Only test transport loses responses. Every broadcast reaches the real Sui
// client once, and every eventual receipt comes from its real ledger service.
const core = new Proxy(client.core, { get(target, name) {
  if (name === 'executeTransaction') return async (input: Parameters<typeof target.executeTransaction>[0]) => {
    broadcasts++; const response = await target.executeTransaction(input);
    if (loseReceipt) throw new Error('Test transport discards an actual execution response');
    return response;
  };
  if (name === 'getTransaction') return async (input: Parameters<typeof target.getTransaction>[0]) => {
    digestQueries++; if (concealLedger) throw new Error('Test transport conceals the ledger response temporarily');
    return target.getTransaction(input);
  };
  const value = Reflect.get(target, name); return typeof value === 'function' ? value.bind(target) : value;
} });
const proxied = { core, network: 'localnet' } as unknown as ClientWithCoreApi;
const manager = (signer: Ed25519Keypair) => new SelfPayTransactionManager({ client: proxied, network: 'localnet', signer, journal });
const rows: Array<Record<string, unknown>> = [];
async function effectsVisible(data: SelfPayTransactionData) {
  const deadline = Date.now() + 20000;
  for (const change of data.effects.changedObjects.filter(row => row.outputState === 'ObjectWrite' || row.outputState === 'PackageWrite')) {
    let found = false;
    while (Date.now() < deadline) {
      try { const { object } = await client.core.getObject({ objectId: change.objectId }); if (BigInt(object.version) >= BigInt(change.outputVersion!)) { found = true; break; } } catch { /* query same effects only */ }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(found, 'Known execution effects must become visible without resubmitting.');
  }
}
async function submit(label: string, m: SelfPayTransactionManager, tx: Transaction, requestId: string) {
  const before = broadcasts, quote = await m.prepare({ requestId, transaction: tx, gasBudget: 2000000000n });
  assert.equal(broadcasts, before, 'A funding update or quote cannot submit automatically.');
  const result = await m.submit(quote);
  assert.equal(result.status, 'confirmed', JSON.stringify(result)); assert.ok(result.transaction);
  await effectsVisible(result.transaction);
  rows.push({ label, quote, digest: result.digest, status: result.status, actualGas: result.actualGas, gasUsed: result.gasUsed });
  console.log(label, 'PASS', result.digest, 'actual Gas', result.actualGas);
  return result.transaction;
}
function created(data: SelfPayTransactionData, suffix: string) { const ids = Object.entries(data.objectTypes).filter(([, type]) => type.endsWith(suffix)).map(([id]) => id); assert.equal(ids.length, 1); return ids[0]; }
const recoveryManager = manager(recovery.signer);
const createHuman = () => sdk.identity.createIdentity({ identityRegistryId: deployment.identityRegistryId, network: 'localnet', recoverySigningKey: recovery.signingPublicKey, recoveryEncryptionKey: recovery.encryptionPublicKey, encryptedBackup: backup, device: desktop.toSuiAddress(), deviceEncryptionKey: deviceKeys.publicKey, encryptedDeviceKeys: wrappedDesktop });
await assert.rejects(recoveryManager.prepare({ requestId: 'create-human', transaction: createHuman(), gasBudget: 2000000000n }), (error: unknown) => error instanceof TransactionPreflightError && error.code === 'needs_funds');
assert.equal(broadcasts, 0);
await Promise.all([recovery.signer, desktop, phone].map(signer => requestSuiFromFaucetV2({ host: faucet, recipient: signer.toSuiAddress() })));
assert.equal(broadcasts, 0, 'Funding cannot automatically sign or create an identity.');
const human = await submit('Selfpay: recovery proof signer creates identity without sponsor', recoveryManager, createHuman(), 'create-human');
const humanId = created(human, '::identity::HumanIdentity'), rootGrant = created(human, '::identity::DeviceGrant');
const desktopManager = manager(desktop);
const orgData = await submit('Selfpay: device creates organization', desktopManager, sdk.identity.createOrganization({ humanId, grantId: rootGrant, name: 'Selfpay acceptance', description: 'Generated localnet fixture' }), 'create-org');
const orgId = created(orgData, '::organization::Organization');
assert.equal((await sdk.organization.getOrganization(orgId)).admin, humanId);

// Real transaction succeeds while the test transport loses both its execution
// response and immediate ledger query. A new manager has only the journal.
loseReceipt = true; concealLedger = true;
const quote = await desktopManager.prepare({ requestId: 'lost-receipt', transaction: sdk.identity.updateOrganizationDescription({ humanId, grantId: rootGrant, organizationId: orgId, description: 'Actual update with discarded response' }), gasBudget: 2000000000n });
const beforeLost = broadcasts;
const pending = await desktopManager.submit(quote); assert.equal(pending.status, 'unknown'); assert.equal(pending.digest, quote.digest);
assert.equal((await manager(desktop).query('lost-receipt'))!.status, 'unknown'); assert.equal(broadcasts, beforeLost + 1);
await assert.rejects(manager(desktop).prepare({ requestId: 'lost-receipt', transaction: sdk.identity.createOrganization({ humanId, grantId: rootGrant, name: 'Must not replay', description: '' }), gasBudget: 2000000000n }), (error: unknown) => error instanceof TransactionPreflightError && error.code === 'already_recorded');
loseReceipt = false; concealLedger = false;
let resolved: SelfPayTransactionOutcome | undefined;
const visibilityDeadline = Date.now() + 20000;
while (Date.now() < visibilityDeadline) { resolved = await manager(desktop).query('lost-receipt'); if (resolved?.status === 'confirmed') break; await new Promise(resolve => setTimeout(resolve, 100)); }
assert.equal(resolved?.status, 'confirmed'); assert.equal(resolved.digest, quote.digest); assert.equal(broadcasts, beforeLost + 1);
rows.push({ label: 'Selfpay: lost receipt resolves original digest after manager restart', quote, digest: resolved.digest, status: resolved.status, actualGas: resolved.actualGas, gasUsed: resolved.gasUsed, broadcasts: 1, digestQueries });
console.log('Lost receipt PASS original digest, no second broadcast');

// A valid simulated operation becomes unauthorized before broadcast because
// another independently funded device revokes this grant. The Gas object of
// the revoked device remains unchanged; this is a real validator failure.
const wrappedPhone = await wrapKeys(keyring, phoneKeys.publicKey, `fractalmind.device-keys.v1:localnet:${phone.toSuiAddress()}`);
const phoneData = await submit('Selfpay: add independent root device', desktopManager, sdk.identity.addRootDevice({ identityRegistryId: deployment.identityRegistryId, humanId, grantId: rootGrant, device: phone.toSuiAddress(), deviceEncryptionKey: phoneKeys.publicKey, encryptedDeviceKeys: wrappedPhone, expiresAtMs: Date.now() + 3600000 }), 'add-phone');
const phoneGrant = created(phoneData, '::identity::DeviceGrant'), phoneManager = manager(phone);
const failureQuote = await desktopManager.prepare({ requestId: 'revoked-after-quote', transaction: sdk.identity.updateOrganizationDescription({ humanId, grantId: rootGrant, organizationId: orgId, description: 'Must fail after revocation' }), gasBudget: 2000000000n });
await submit('Selfpay: second device revokes original grant after quote', phoneManager, sdk.identity.revokeDevice({ humanId, grantId: phoneGrant, targetGrantId: rootGrant }), 'revoke-original');
const failed = await desktopManager.submit(failureQuote);
assert.equal(failed.status, 'failed', JSON.stringify(failed)); assert.ok(BigInt(failed.actualGas!) > 0n); assert.ok(failed.transaction);
await effectsVisible(failed.transaction);
assert.equal((await sdk.organization.getOrganization(orgId)).description, 'Actual update with discarded response');
rows.push({ label: 'Selfpay: revoked-after-quote fails with real charged Gas', quote: failureQuote, digest: failed.digest, status: failed.status, actualGas: failed.actualGas, gasUsed: failed.gasUsed, failure: failed.reason });
console.log('Validator failure PASS charged Gas', failed.actualGas);

// Consumption uses the recovery-derived signer paying its own Gas. No old
// desktop/phone signer or sponsor is passed to the recovery transaction.
const newCode = createRecoveryCode('localnet'), next = recoveryKeys(newCode, 'localnet');
const nextBackup = await wrapKeys(keyring, next.encryptionPublicKey, `fractalmind.recovery-backup.v1:localnet:${next.address}`);
const wrappedReplacement = await wrapKeys(keyring, replacementKeys.publicKey, `fractalmind.device-keys.v1:localnet:${replacementPhone.toSuiAddress()}`);
const current = await sdk.identity.getHuman(humanId);
const recovered = await submit('Selfpay: recovery-derived signer consumes recovery without old wallet or sponsor', recoveryManager, sdk.identity.recoverIdentity({ identityRegistryId: deployment.identityRegistryId, humanId, recordId: current.recovery_record, recoverySigningKey: next.signingPublicKey, recoveryEncryptionKey: next.encryptionPublicKey, encryptedBackup: nextBackup, device: replacementPhone.toSuiAddress(), deviceEncryptionKey: replacementKeys.publicKey, encryptedDeviceKeys: wrappedReplacement }), 'recover-human');
assert.equal(recovered.transaction.sender, recovery.address); assert.equal(recovered.transaction.gasData.owner, recovery.address);
const afterRecovery = await sdk.identity.getHuman(humanId);
assert.equal(afterRecovery.id, humanId); assert.equal(BigInt(afterRecovery.generation), BigInt(current.generation) + 1n);
assert.equal((await sdk.identity.getDeviceGrant(phoneGrant)).generation, current.generation);
assert.ok(afterRecovery.organizations.includes(orgId));
const report = { schema: 'fractalmind.v020-selfpay-transaction-manager.v1', testedAt: new Date().toISOString(), chain: await client.core.getChainIdentifier(), packageId: deployment.packageId, humanId, organizationId: orgId, transactions: rows, broadcasts, digestQueries,
  checks: { zeroFundsStopsBeforeSignature: true, fundingDoesNotAutoSubmit: true, realSimulationAndFees: true, originalDigestAfterResponseLoss: true, restartDidNotResubmit: true, validatorFailureChargedGas: true, stableHumanSelfpayRecovery: true, oldWalletOrSponsorNeededForRecovery: false, browserDurabilityVerifiedBySeparateFixture: true, fullAppUiVerified: false, addressBalanceGasLiveVerified: false } };
await writeFile(process.argv[3], JSON.stringify(report, null, 2)+'\n');
keyring.fill(0); contentKey.fill(0); deviceKeys.secret.fill(0); phoneKeys.secret.fill(0); replacementKeys.secret.fill(0); recovery.encryptionSecret.fill(0); next.encryptionSecret.fill(0);
console.log('Selfpay transaction manager localnet acceptance PASS. No recovery codes or signing keys recorded.');
