import { randomBytes, scrypt as scryptCallback, createCipheriv, createDecipheriv } from 'node:crypto';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { readJson, writePrivateJson, configDir } from './storage.js';
import type { StoredKey } from './types.js';

const scrypt = promisify(scryptCallback);
const SERVICE = 'org.fractalmind.fm';
const encryptedKeyPath = (keyRef: string) => join(configDir(), 'keys', `${keyRef.replace(/[^A-Za-z0-9._-]/g, '_')}.json`);
type EncryptedFile = { version: 1; salt: string; iv: string; tag: string; ciphertext: string };

export type KeyStoreResult = { key: StoredKey | null; weaker: boolean };

function passphrase(): string | null { return process.env.FM_KEY_PASSPHRASE || null; }

async function encryptedWrite(keyRef: string, value: StoredKey, phrase: string) {
  const salt = randomBytes(16), iv = randomBytes(12);
  const key = await scrypt(phrase, salt, 32) as Buffer;
  try {
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(`${SERVICE}:${keyRef}`, 'utf8'));
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
    await writePrivateJson(encryptedKeyPath(keyRef), {
      version: 1, salt: salt.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64'),
    } satisfies EncryptedFile);
  } finally { key.fill(0); }
}

async function encryptedRead(keyRef: string, phrase: string): Promise<StoredKey | null> {
  const stored = await readJson<EncryptedFile>(encryptedKeyPath(keyRef));
  if (!stored) return null;
  if (stored.version !== 1) throw new Error('Unsupported encrypted key file version.');
  const key = await scrypt(phrase, Buffer.from(stored.salt, 'base64'), 32) as Buffer;
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(stored.iv, 'base64'));
    decipher.setAAD(Buffer.from(`${SERVICE}:${keyRef}`, 'utf8'));
    decipher.setAuthTag(Buffer.from(stored.tag, 'base64'));
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(stored.ciphertext, 'base64')), decipher.final()]).toString('utf8')) as StoredKey;
  } finally { key.fill(0); }
}

/** keytar maps to Keychain/Credential Manager/Secret Service.  macOS Keychain
 * maintains application access controls itself; an unfamiliar application
 * asking for this item is mediated by the system prompt. */
async function systemStore() { return import('keytar'); }

export async function saveKey(keyRef: string, key: StoredKey): Promise<{ weaker: boolean }> {
  const phrase = passphrase();
  if (phrase) { await encryptedWrite(keyRef, key, phrase); return { weaker: true }; }
  try {
    const keytar = await systemStore();
    await keytar.setPassword(SERVICE, keyRef, JSON.stringify(key));
    return { weaker: false };
  } catch (error) {
    throw new Error(`System secret store unavailable. Set FM_KEY_PASSPHRASE for the encrypted-file fallback: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function loadKey(keyRef: string): Promise<KeyStoreResult> {
  const phrase = passphrase();
  if (phrase) return { key: await encryptedRead(keyRef, phrase), weaker: true };
  try {
    const keytar = await systemStore();
    const value = await keytar.getPassword(SERVICE, keyRef);
    return { key: value ? JSON.parse(value) as StoredKey : null, weaker: false };
  } catch (error) {
    throw new Error(`System secret store unavailable. Set FM_KEY_PASSPHRASE for the encrypted-file fallback: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function deleteKey(keyRef: string): Promise<void> {
  const phrase = passphrase();
  if (phrase) {
    const { rm } = await import('node:fs/promises');
    await rm(encryptedKeyPath(keyRef), { force: true });
    return;
  }
  const keytar = await systemStore();
  await keytar.deletePassword(SERVICE, keyRef);
}
