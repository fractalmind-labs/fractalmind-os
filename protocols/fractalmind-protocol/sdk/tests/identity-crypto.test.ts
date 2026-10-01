import assert from 'node:assert/strict';
import test from 'node:test';
import { createRecoveryCode, parseRecoveryCode, recoveryKeys, createDeviceEncryptionKeys, encryptContent, decryptContent, wrapKeys, unwrapKeys, randomContentKey } from '../src/identity-crypto.js';

test('one recovery code deterministically locates the recovery signer and decryption key', () => {
  const code = createRecoveryCode('testnet');
  const a = recoveryKeys(code, 'testnet');
  const b = recoveryKeys(code, 'testnet');
  assert.equal(a.address, b.address);
  assert.deepEqual(a.encryptionPublicKey, b.encryptionPublicKey);
  assert.equal(parseRecoveryCode(code).entropy.length, 32);
  assert.notEqual(a.address, recoveryKeys(createRecoveryCode('testnet')).address);
  assert.throws(() => recoveryKeys(code, 'mainnet'), /another network/);
  assert.throws(() => parseRecoveryCode(code.slice(0, -1) + (code.endsWith('0') ? '1' : '0')), /checksum/);
  assert.throws(() => parseRecoveryCode('FM0:testnet:00:00'), /format/);
});

test('encrypted records authenticate context, ciphertext and key and use fresh nonces', async () => {
  const plaintext = new TextEncoder().encode('项目 OKR 和审批正文');
  const key = randomContentKey();
  const context = 'org-1:okr-1:revision-1:key-1';
  const a = await encryptContent(plaintext, key, context);
  const b = await encryptContent(plaintext, key, context);
  assert.notDeepEqual(a, b);
  assert.deepEqual(await decryptContent(a, key, context), plaintext);
  await assert.rejects(decryptContent(a, key, 'org-2:okr-1:revision-1:key-1'));
  await assert.rejects(decryptContent(a, randomContentKey(), context));
  const tampered = a.slice(); tampered[tampered.length - 1] ^= 1;
  await assert.rejects(decryptContent(tampered, key, context));
  await assert.rejects(encryptContent(new Uint8Array(65537), key, context), /limit/);
});

test('key distribution and recovery use independent recipient secrets', async () => {
  const desktop = createDeviceEncryptionKeys();
  const phone = createDeviceEncryptionKeys();
  const recovery = recoveryKeys(createRecoveryCode('localnet'));
  const root = randomContentKey();
  const phoneBackup = await wrapKeys(root, phone.publicKey, 'human-1:device-phone:generation-1');
  assert.deepEqual(await unwrapKeys(phoneBackup, phone.secret, 'human-1:device-phone:generation-1'), root);
  await assert.rejects(unwrapKeys(phoneBackup, desktop.secret, 'human-1:device-phone:generation-1'));
  const recoveryBackup = await wrapKeys(root, recovery.encryptionPublicKey, 'human-1:recovery-version-1');
  assert.deepEqual(await unwrapKeys(recoveryBackup, recovery.encryptionSecret, 'human-1:recovery-version-1'), root);
  // An authorized device can publish a fresh key to the recovery public key
  // without having the recovery secret. Revoked devices retain old data only.
  const rotated = randomContentKey();
  const newRecord = await encryptContent(new TextEncoder().encode('new private result'), rotated, 'org-1:record-2:key-2');
  await assert.rejects(decryptContent(newRecord, root, 'org-1:record-2:key-2'));
  const rotatedBackup = await wrapKeys(rotated, recovery.encryptionPublicKey, 'human-1:recovery-version-1');
  assert.deepEqual(await unwrapKeys(rotatedBackup, recovery.encryptionSecret, 'human-1:recovery-version-1'), rotated);
});

test('low-order recipients and malformed wrapping envelopes are rejected', async () => {
  await assert.rejects(wrapKeys(randomContentKey(), new Uint8Array(32), 'human-1'));
  await assert.rejects(unwrapKeys(new Uint8Array(100), randomContentKey(), 'human-1'), /envelope/);
});
