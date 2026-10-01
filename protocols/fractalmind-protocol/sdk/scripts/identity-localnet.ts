/** Real-chain acceptance slice. Requires an isolated localnet and a fresh
 * zero-address compiled package. Never imports or prints a user's keystore.
 * node --import tsx scripts/identity-localnet.ts /tmp/bytecode.json /tmp/report.json
 */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { requestSuiFromFaucetV2 } from '@mysten/sui/faucet';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import { bcs } from '@mysten/sui/bcs';
import { FractalMindSDK, createRecoveryCode, recoveryKeys, createDeviceEncryptionKeys, wrapKeys, unwrapKeys, randomContentKey, bytesToHex, hexToBytes, PRODUCT_RECORD_KINDS } from '../src/index.js';
import type { ProductRecordKind } from '../src/index.js';
import { bytesArgument } from '../src/wire-bytes.js';
import { exerciseHostAdmission } from './host-localnet-cases.js';
import { verifyGoAuthority } from './verify-go-authority.js';

const baseUrl = process.env.FM_LOCALNET_RPC ?? 'http://127.0.0.1:29000';
const faucet = process.env.FM_LOCALNET_FAUCET ?? 'http://127.0.0.1:29123';
for (const url of [baseUrl, faucet]) assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname), 'This script only spends localnet SUI.');
assert.ok(process.env.FM_NODE_CHECKPOINT_ACCEPTANCE !== '1' || process.env.FM_HOST_ACCEPTANCE === '1', 'Command checkpoint acceptance requires FM_HOST_ACCEPTANCE=1.');
const bytecodePath = process.argv[2];
assert.ok(bytecodePath, 'Pass the bytecode JSON built from a zero-address test copy.');
const c = new SuiGrpcClient({ baseUrl, network: 'localnet' });
const desktop = Ed25519Keypair.generate();
const phone = Ed25519Keypair.generate();
const desktopAddress = desktop.getPublicKey().toSuiAddress();
const phoneAddress = phone.getPublicKey().toSuiAddress();
const deviceKeys = createDeviceEncryptionKeys();
const phoneKeys = createDeviceEncryptionKeys();
const code = createRecoveryCode('localnet');
const recovery = recoveryKeys(code, 'localnet');
const rows: Record<string, unknown>[] = [];
const include = { effects: true, objectTypes: true, events: true } as const;
async function execute(label: string, tx: Transaction, signer = desktop, sponsor?: Ed25519Keypair, allowRejected = false) {
  tx.setSender(signer.getPublicKey().toSuiAddress());
  tx.setGasBudget(2000000000);
  if (sponsor) tx.setGasOwner(sponsor.getPublicKey().toSuiAddress());
  // Always resolve current gas references. Automatic coin selection may retain
  // a cached reference after explicit negative transactions or a Go Host start.
  // Negative cases still reach validators instead of stopping at simulation.
  await tx.build({ client: c, onlyTransactionKind: true });
  const payer = (sponsor ?? signer).getPublicKey().toSuiAddress();
  const coins = await c.core.listCoins({ owner: payer });
  const coin = coins.objects.find(coin => BigInt(coin.balance) >= 2000000000n);
  assert.ok(coin, 'Expected a funded localnet gas coin.');
  // The owner/coin index can lag behind the latest ledger object even when a
  // prior execution's effects are already visible. Hydrate its actual reference.
  const { object: gasObject } = await c.core.getObject({ objectId: coin.objectId });
  tx.setGasPayment([{ objectId: gasObject.objectId, version: gasObject.version, digest: gasObject.digest }]);
  tx.setGasPrice((await c.core.getReferenceGasPrice()).referenceGasPrice);
  const bytes = allowRejected ? await tx.build() : await tx.build({ client: c });
  const signatures = [(await signer.signTransaction(bytes)).signature];
  if (sponsor) signatures.push((await sponsor.signTransaction(bytes)).signature);
  const result = await c.core.executeTransaction({ transaction: bytes, signatures, include });
  const data = result.$kind === 'Transaction' ? result.Transaction : result.FailedTransaction;
  const row = { label, digest: data.digest, status: data.status, gasUsed: data.effects?.gasUsed, changedObjects: data.effects?.changedObjects, confirmation: 'effects returned; ledger visibility pending' };
  rows.push(row);
  console.log(label, data.status.success ? 'PASS' : 'REJECTED', data.digest);
  // Keep public transaction evidence even if confirmation is interrupted.
  // This contains no generated key material or recovery/invitation codes.
  if (process.argv[3]) await writeFile(`${process.argv[3]}.progress.json`, JSON.stringify({ complete: false, transactions: rows }, null, 2));
  // Localnet prunes transaction history aggressively. Confirm that the exact
  // effects returned by ExecuteTransaction are visible through current object
  // versions, without resubmitting or depending on retained history. Version
  // visibility is not used to infer transaction success: status comes from the
  // execution response above, including actual validator-rejected cases.
  assert.equal(data.effects?.transactionDigest, data.digest);
  const writes = data.effects!.changedObjects.filter(object => object.outputState === 'ObjectWrite' || object.outputState === 'PackageWrite');
  assert.ok(writes.length > 0, 'Confirmed effects must include the paid gas object.');
  const confirmationSignal = AbortSignal.timeout(20000);
  for (const write of writes) {
    let lastError: unknown;
    while (!confirmationSignal.aborted) {
      try {
        const { object } = await c.core.getObject({ objectId: write.objectId, signal: confirmationSignal });
        if (BigInt(object.version) >= BigInt(write.outputVersion!)) { lastError = undefined; break; }
        lastError = new Error(`Object ${write.objectId} has not reached version ${write.outputVersion}.`);
      } catch (error) { lastError = error; }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (lastError || confirmationSignal.aborted) throw new Error(`Cannot confirm ${data.digest}; query its digest or effect object versions before retrying.`, { cause: lastError });
  }
  row.confirmation = 'execution effects and output object versions confirmed';
  if (process.argv[3]) await writeFile(`${process.argv[3]}.progress.json`, JSON.stringify({ complete: false, transactions: rows }, null, 2));
  return { result, data };
}
function created(data: Awaited<ReturnType<typeof execute>>['data'], suffix: string): string {
  const ids = Object.entries(data.objectTypes ?? {}).filter(([, type]) => type.endsWith(suffix)).map(([id]) => id);
  assert.equal(ids.length, 1, `Expected one ${suffix}`);
  return ids[0];
}
await requestSuiFromFaucetV2({ host: faucet, recipient: desktopAddress });
await requestSuiFromFaucetV2({ host: faucet, recipient: phoneAddress });
const bytecode = JSON.parse(await readFile(bytecodePath, 'utf8'));
const publish = new Transaction();
const [upgradeCap] = publish.publish(bytecode);
publish.transferObjects([upgradeCap], desktopAddress);
const published = await execute('publish test package', publish);
assert.equal(published.data.status.success, true);
const packageId = published.data.effects!.changedObjects.find(object => object.outputState === 'PackageWrite')!.objectId;
const registryId = created(published.data, '::organization::ProtocolRegistry');
let sdk = new FractalMindSDK({ packageId, registryId, client: c, network: 'localnet' });
assert.equal((await execute('initialize authenticated identity registry', sdk.identity.initializeRegistry())).data.status.success, true);
const identityRegistryId = await sdk.identity.resolveRegistry();
const originalContentKey = randomContentKey();
let keyring = new TextEncoder().encode(JSON.stringify({ format: 1, contentKey: bytesToHex(originalContentKey), historicalKeys: { '1': bytesToHex(originalContentKey) } }));
const recoveryContext = `fractalmind.recovery-backup.v1:localnet:${recovery.address}`;
const deviceContext = `fractalmind.device-keys.v1:localnet:${desktopAddress}`;
const encryptedBackup = await wrapKeys(keyring, recovery.encryptionPublicKey, recoveryContext);
const encryptedDeviceKeys = await wrapKeys(keyring, deviceKeys.publicKey, deviceContext);
const made = await execute('create Human using recovery signature and device-paid gas', sdk.identity.createIdentity({
  identityRegistryId, network: 'localnet', recoverySigningKey: recovery.signingPublicKey,
  recoveryEncryptionKey: recovery.encryptionPublicKey, encryptedBackup,
  device: desktopAddress, deviceEncryptionKey: deviceKeys.publicKey, encryptedDeviceKeys,
}), recovery.signer, desktop);
assert.equal(made.data.status.success, true);
const humanId = created(made.data, '::identity::HumanIdentity');
const rootGrantId = created(made.data, '::identity::DeviceGrant');
const organization = await execute('create organization bound to Human', sdk.identity.createOrganization({ humanId, grantId: rootGrantId, name: `Identity-test-${Date.now()}`, description: 'localnet acceptance' }));
assert.equal(organization.data.status.success, true);
const organizationId = created(organization.data, '::organization::Organization');
const orgBefore = await sdk.organization.getOrganization(organizationId);
assert.equal(orgBefore.admin, humanId);
const recordChecks: Record<string, unknown>[] = [];
const originalBodies = new Map<string, Uint8Array>();
for (const [index, kind] of (Object.keys(PRODUCT_RECORD_KINDS) as ProductRecordKind[]).entries()) {
  const payloadBytes = [256, 1024, 4096, 8192, 16384, 32768, 65504][index];
  const body = { kind, objective: '在限定工作区完成任务', state: 'representative body', notes: '' };
  const overhead = new TextEncoder().encode(JSON.stringify(body)).length;
  body.notes = 'x'.repeat(payloadBytes - overhead);
  const plaintext = new TextEncoder().encode(JSON.stringify(body));
  assert.equal(plaintext.length, payloadBytes);
  originalBodies.set(kind, plaintext);
  const saved = await execute(`save encrypted ${kind} (${payloadBytes} bytes)`, await sdk.productRecord.encryptAndSave({ organizationId, humanId, grantId: rootGrantId, kind, logicalId: `sample-${kind}`, expectedRevision: 0n, keyVersion: 1n, plaintext, key: originalContentKey }));
  assert.equal(saved.data.status.success, true);
  const recordId = created(saved.data, '::product_record::EncryptedRecord');
  const record = await sdk.productRecord.getRecord(recordId);
  const object = await c.core.getObject({ objectId: recordId, include: { content: true } });
  assert.equal(record.encrypted_body.length, payloadBytes + 32);
  assert.deepEqual((await sdk.productRecord.decryptRecord(recordId, originalContentKey)).plaintext, plaintext);
  recordChecks.push({ kind, payloadBytes, encryptedBytes: record.encrypted_body.length, objectBytes: object.object.content!.length, recordId, digest: saved.data.digest, gasUsed: saved.data.effects!.gasUsed });
  if (process.env.FM_STORAGE_CANDIDATE === '1') {
    const inline = new Transaction();
    inline.moveCall({ target: `${packageId}::storage_candidate::save_inline`, arguments: [inline.object(organizationId), inline.object(humanId), inline.object(rootGrantId), inline.pure.u8(PRODUCT_RECORD_KINDS[kind]), inline.pure.string(`sample-${kind}`), inline.pure.u64(0), inline.pure.u64(1), bytesArgument(inline, packageId, Uint8Array.from(record.encrypted_body)), inline.object('0x6')] });
    const alternative = await execute(`candidate inline ${kind} (${payloadBytes} bytes)`, inline);
    assert.equal(alternative.data.status.success, true);
    const field = await c.core.getDynamicField({ parentId: organizationId, name: { type: `${packageId}::storage_candidate::InlineKey`, bcs: bcs.struct('InlineKey', { kind: bcs.u8(), logical_id: bcs.string() }).serialize({ kind: PRODUCT_RECORD_KINDS[kind], logical_id: `sample-${kind}` }).toBytes() } });
    const value = bcs.struct('InlineBody', { revision: bcs.u64(), key_version: bcs.u64(), created_at_ms: bcs.u64(), writer_human: bcs.Address, writer_device: bcs.Address, encrypted_body: bcs.vector(bcs.u8()) }).parse(field.dynamicField.value.bcs);
    assert.deepEqual(value.encrypted_body, record.encrypted_body);
    const inlineObject = await c.core.getObject({ objectId: field.dynamicField.fieldId, include: { content: true } });
    recordChecks[recordChecks.length - 1].inlineObjectBytes = inlineObject.object.content!.length;
    recordChecks[recordChecks.length - 1].inlineGasUsed = alternative.data.effects!.gasUsed;
    recordChecks[recordChecks.length - 1].inlineDigest = alternative.data.digest;
  }
}
const phoneContext = `fractalmind.device-keys.v1:localnet:${phoneAddress}`;
assert.equal((await execute('add phone with seven-day org-scoped read grant', sdk.identity.addReadDevice({
  identityRegistryId, humanId, grantId: rootGrantId, organizationId,
  device: phoneAddress, deviceEncryptionKey: phoneKeys.publicKey,
  encryptedDeviceKeys: await wrapKeys(keyring, phoneKeys.publicKey, phoneContext),
}))).data.status.success, true);
let human = await sdk.identity.getHuman(humanId);
const phoneGrantId = human.grants[1];
const phoneGrant = await sdk.identity.getDeviceGrant(phoneGrantId);
const hostReport = process.env.FM_HOST_ACCEPTANCE === '1'
  ? await exerciseHostAdmission({ sdk, execute, created, humanId, organizationId, rootGrantId, phoneGrantId, desktop, phone, faucet, contentKey: originalContentKey })
  : undefined;
assert.deepEqual(phoneGrant.actions, [1]);
assert.equal(phoneGrant.org_scope, organizationId);
assert.equal(phoneGrant.device, phoneAddress);
assert.deepEqual(await unwrapKeys(Uint8Array.from(phoneGrant.encrypted_keys), phoneKeys.secret, phoneContext), keyring);
const denied = await execute('read-only phone cannot create organization', sdk.identity.createOrganization({ humanId, grantId: phoneGrantId, name: 'ReadOnly-denied', description: '' }), phone, undefined, true);
assert.equal(denied.data.status.success, false);
assert.match(JSON.stringify(denied.data.status), /9001/);
const deniedWrite = await execute('read-only phone cannot modify a canonical body', await sdk.productRecord.encryptAndSave({ organizationId, humanId, grantId: phoneGrantId, kind: 'message', logicalId: 'unauthorized-message', expectedRevision: 0n, keyVersion: 1n, plaintext: new TextEncoder().encode('unauthorized'), key: originalContentKey }), phone, undefined, true);
assert.equal(deniedWrite.data.status.success, false);
assert.match(JSON.stringify(deniedWrite.data.status), /9001/);
// Revocation prevents new authorized writes; rotating keys protects future
// bodies. The already downloaded version remains readable by an old device.
const newContentKey = randomContentKey();
keyring = new TextEncoder().encode(JSON.stringify({ format: 1, contentKey: bytesToHex(newContentKey), historicalKeys: { '1': bytesToHex(originalContentKey), '2': bytesToHex(newContentKey) } }));
const updatedBackup = await wrapKeys(keyring, recovery.encryptionPublicKey, recoveryContext);
const keyUpdate = sdk.identity.revokeDevice({ humanId, grantId: rootGrantId, targetGrantId: phoneGrantId });
sdk.productRecord.rotateKey({ organizationId, humanId, grantId: rootGrantId, expectedKeyVersion: 1n, tx: keyUpdate });
sdk.identity.updateRecoveryBackup({ humanId, grantId: rootGrantId, recordId: (await sdk.identity.getHuman(humanId)).recovery_record, expectedBackupVersion: 1n, encryptedBackup: updatedBackup, tx: keyUpdate });
sdk.identity.updateDeviceKeys({ humanId, grantId: rootGrantId, targetGrantId: rootGrantId, organizationId, expectedVersion: 1n, encryptedKeys: await wrapKeys(keyring, deviceKeys.publicKey, deviceContext), tx: keyUpdate });
assert.equal((await execute('revoke phone and rotate content generation, device and recovery keyring atomically', keyUpdate)).data.status.success, true);
assert.equal((await sdk.identity.getDeviceGrant(phoneGrantId)).revoked, true);
assert.equal((await sdk.identity.getDeviceGrant(rootGrantId)).revoked, false);
const newMessage = new TextEncoder().encode('撤销设备后的新消息，使用新的密钥代次');
const advanced = await execute('save future message with rotated key', await sdk.productRecord.encryptAndSave({ organizationId, humanId, grantId: rootGrantId, kind: 'message', logicalId: 'sample-message', expectedRevision: 1n, keyVersion: 2n, plaintext: newMessage, key: newContentKey }));
assert.equal(advanced.data.status.success, true);
const futureMessageId = created(advanced.data, '::product_record::EncryptedRecord');
await assert.rejects(sdk.productRecord.decryptRecord(futureMessageId, originalContentKey));
assert.deepEqual((await sdk.productRecord.decryptRecord(futureMessageId, newContentKey)).plaintext, newMessage);
const futureRecord = await sdk.productRecord.getRecord(futureMessageId);
assert.ok(futureRecord.previous);
assert.deepEqual((await sdk.productRecord.decryptRecord(futureRecord.previous, originalContentKey)).plaintext, originalBodies.get('message'));
const stale = await execute('stale body revision rejected atomically', await sdk.productRecord.encryptAndSave({ organizationId, humanId, grantId: rootGrantId, kind: 'message', logicalId: 'sample-message', expectedRevision: 1n, keyVersion: 2n, plaintext: newMessage, key: newContentKey }), desktop, undefined, true);
assert.equal(stale.data.status.success, false);
assert.match(JSON.stringify(stale.data.status), /9102/);

// Drop client state. Resolve the stable identity using only one recovery code
// plus public network/package configuration, not a saved Human object ID.
sdk = new FractalMindSDK({ packageId, registryId, client: c, network: 'localnet' });
const located = await sdk.identity.locateRecovery(code, 'localnet');
assert.equal(located.human.id, humanId);
const restored = await unwrapKeys(Uint8Array.from(located.record.encrypted_backup), recovery.encryptionSecret, recoveryContext);
assert.deepEqual(restored, keyring);
const restoredKeyring = JSON.parse(new TextDecoder().decode(restored));
const current = await sdk.productRecord.listCurrent(organizationId, null, 3);
let records = current.records;
let page = current;
while (page.hasNextPage) {
  page = await sdk.productRecord.listCurrent(organizationId, page.cursor, 3);
  records = [...records, ...page.records];
}
assert.equal(records.length, 7 + (hostReport?.executions?.records.length ?? 0));
for (const pointer of records) {
  const keys = hexToBytes(restoredKeyring.historicalKeys[pointer.key_version]);
  const decoded = await sdk.productRecord.decryptRecord(pointer.record_id, keys);
  const kind = Object.entries(PRODUCT_RECORD_KINDS).find(([, value]) => value === pointer.kind)![0];
  const executionBody = hostReport?.executions?.records.find(body => body.logicalId === pointer.logicalId);
  if (executionBody) { assert.equal(new TextDecoder().decode(decoded.plaintext), executionBody.plaintext); continue; }
  assert.deepEqual(decoded.plaintext, kind === 'message' ? newMessage : originalBodies.get(kind));
}
const nextCode = createRecoveryCode('localnet');
const nextRecovery = recoveryKeys(nextCode, 'localnet');
const nextContext = `fractalmind.recovery-backup.v1:localnet:${nextRecovery.address}`;
const recover = () => sdk.identity.recoverIdentity({
  identityRegistryId, humanId, recordId: located.record.id,
  recoverySigningKey: nextRecovery.signingPublicKey, recoveryEncryptionKey: nextRecovery.encryptionPublicKey,
  encryptedBackup: new Uint8Array(), device: phoneAddress, deviceEncryptionKey: phoneKeys.publicKey, encryptedDeviceKeys: new Uint8Array(),
});
const recoveryTx = recover();
const recoveryContentKey = randomContentKey();
const recoveryKeyring = new TextEncoder().encode(JSON.stringify({ ...restoredKeyring, contentKey: bytesToHex(recoveryContentKey), historicalKeys: { ...restoredKeyring.historicalKeys, '3': bytesToHex(recoveryContentKey) } }));
const atomicRecovery = sdk.productRecord.rotateKeyForRecovery({ organizationId, humanId, recordId: located.record.id, expectedKeyVersion: 2n });
// Supply authentic encrypted data in the successful transaction.
const recovered = await execute('atomically recover Human, revoke all old devices, consume old code', sdk.identity.recoverIdentity({
  identityRegistryId, humanId, recordId: located.record.id,
  recoverySigningKey: nextRecovery.signingPublicKey, recoveryEncryptionKey: nextRecovery.encryptionPublicKey,
  encryptedBackup: await wrapKeys(recoveryKeyring, nextRecovery.encryptionPublicKey, nextContext),
  device: phoneAddress, deviceEncryptionKey: phoneKeys.publicKey,
  encryptedDeviceKeys: await wrapKeys(recoveryKeyring, phoneKeys.publicKey, phoneContext), tx: atomicRecovery,
}), recovery.signer, desktop);
assert.equal(recovered.data.status.success, true);
human = await sdk.identity.getHuman(humanId);
assert.equal(human.generation, '2');
if (hostReport) {
  await verifyGoAuthority(packageId, hostReport.freshCapabilityId, 'revoked');
  // Recovery revokes device authority, not the organization's admitted Hosts.
  await verifyGoAuthority(packageId, hostReport.freshObservationCapabilityId);
}
assert.deepEqual(human.organizations, [organizationId]);
assert.equal((await sdk.organization.getOrganization(organizationId)).admin, humanId);
const newPhoneGrantId = human.grants[2];
const newPhoneGrant = await sdk.identity.getDeviceGrant(newPhoneGrantId);
assert.equal(newPhoneGrant.generation, '2');
assert.deepEqual(await unwrapKeys(Uint8Array.from(newPhoneGrant.encrypted_keys), phoneKeys.secret, phoneContext), recoveryKeyring);
const oldDesktop = await execute('old desktop authorization rejected after recovery', sdk.identity.createOrganization({ humanId, grantId: rootGrantId, name: 'OldDesktop-denied', description: '' }), desktop, undefined, true);
assert.equal(oldDesktop.data.status.success, false);
assert.match(JSON.stringify(oldDesktop.data.status), /9003/);
const replay = await execute('replay of consumed recovery record rejected', recoveryTx, recovery.signer, desktop, true);
assert.equal(replay.data.status.success, false);
assert.match(JSON.stringify(replay.data.status), /9005/);
await assert.rejects(sdk.identity.locateRecovery(code, 'localnet'), /consumed/);
sdk = new FractalMindSDK({ packageId, registryId, client: c, network: 'localnet' });
const nextLocated = await sdk.identity.locateRecovery(nextCode, 'localnet');
assert.equal(nextLocated.human.id, humanId);
const recoveredBackup = await unwrapKeys(Uint8Array.from(nextLocated.record.encrypted_backup), nextRecovery.encryptionSecret, nextContext);
assert.deepEqual(recoveredBackup, recoveryKeyring);
const recoveredKeyring = JSON.parse(new TextDecoder().decode(recoveredBackup));
const recoveredCheckpointRecords: string[] = [];
if (hostReport?.executions) {
  // Verify decryption again after consumption and key rotation, using only the
  // replacement recovery record and a newly constructed SDK, not cached IDs.
  const recoveredOrganizationId = nextLocated.human.organizations[0];
  const pointers = await sdk.productRecord.listCurrent(recoveredOrganizationId, null, 50);
  for (const expected of hostReport.executions.records) {
    const pointer = pointers.records.find(pointer => pointer.logicalId === expected.logicalId);
    assert.ok(pointer, 'Recovered chain index must locate the command result.');
    const key = hexToBytes(recoveredKeyring.historicalKeys[pointer.key_version]);
    const decoded = await sdk.productRecord.decryptRecord(pointer.record_id, key);
    assert.equal(new TextDecoder().decode(decoded.plaintext), expected.plaintext);
    recoveredCheckpointRecords.push(pointer.record_id);
  }
}
const afterRecovery = await execute('persist future body inaccessible to all lost devices', await sdk.productRecord.encryptAndSave({ organizationId, humanId, grantId: newPhoneGrantId, kind: 'message', logicalId: 'after-recovery', expectedRevision: 0n, keyVersion: 3n, plaintext: newMessage, key: recoveryContentKey }), phone);
assert.equal(afterRecovery.data.status.success, true);
const postRecoveryId = created(afterRecovery.data, '::product_record::EncryptedRecord');
await assert.rejects(sdk.productRecord.decryptRecord(postRecoveryId, newContentKey));
assert.deepEqual((await sdk.productRecord.decryptRecord(postRecoveryId, recoveryContentKey)).plaintext, newMessage);
assert.equal((await execute('recovered phone operates same Human', sdk.identity.createOrganization({ humanId, grantId: newPhoneGrantId, name: `Recovered-${Date.now()}`, description: '' }), phone)).data.status.success, true);
const report = { testedAt: new Date().toISOString(), chain: await c.core.getChainIdentifier(), packageId, registryId, identityRegistryId, humanId, organizationId, checks: rows, records: recordChecks, host: hostReport, recoveredCheckpointRecords };
if (process.argv[3]) await writeFile(process.argv[3], `${JSON.stringify(report, null, 2)}\n`);
console.log('Identity localnet acceptance passed. Recovery codes and private keys were not recorded.');
