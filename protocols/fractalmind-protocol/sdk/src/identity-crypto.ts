import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { x25519 } from '@noble/curves/ed25519.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import type { NetworkName } from './types.js';

const utf8 = new TextEncoder();
const RECOVERY_DOMAIN = utf8.encode('fractalmind.recovery.v1');
const DATA_MAGIC = utf8.encode('FME1');
const WRAP_MAGIC = utf8.encode('FMW1');
const MAX_PLAINTEXT_BYTES = 64 * 1024;
const NETWORKS: readonly string[] = ['localnet', 'devnet', 'testnet', 'mainnet'];

/** Recovery codes hold 256 bits of random entropy. They never contain a Human
 * ID; derive the recovery address and resolve its authenticated chain record. */
export function createRecoveryCode(network: NetworkName): string {
  if (!NETWORKS.includes(network)) throw new Error('Unsupported recovery network.');
  const prefix = `FM1:${network}:${bytesToHex(randomBytes(32))}`;
  return `${prefix}:${bytesToHex(sha256(utf8.encode(prefix))).slice(0, 8)}`;
}

export function parseRecoveryCode(code: string): { network: NetworkName; entropy: Uint8Array } {
  const parts = code.trim().split(':');
  if (parts.length !== 4 || parts[0] !== 'FM1' || !NETWORKS.includes(parts[1])) throw new Error('Invalid recovery code format or network.');
  if (!/^[0-9a-f]{64}$/.test(parts[2]) || !/^[0-9a-f]{8}$/.test(parts[3])) throw new Error('Invalid recovery code encoding.');
  const expected = bytesToHex(sha256(utf8.encode(parts.slice(0, 3).join(':')))).slice(0, 8);
  if (parts[3] !== expected) throw new Error('Recovery code checksum does not match.');
  return { network: parts[1] as NetworkName, entropy: hexToBytes(parts[2]) };
}

export function recoveryKeys(code: string, expectedNetwork?: NetworkName) {
  const parsed = parseRecoveryCode(code);
  if (expectedNetwork && expectedNetwork !== parsed.network) throw new Error('Recovery code belongs to another network.');
  const signingSeed = hkdf(sha256, parsed.entropy, RECOVERY_DOMAIN, utf8.encode('signing'), 32);
  const encryptionSecret = hkdf(sha256, parsed.entropy, RECOVERY_DOMAIN, utf8.encode('encryption'), 32);
  const signer = Ed25519Keypair.fromSecretKey(signingSeed);
  signingSeed.fill(0);
  parsed.entropy.fill(0);
  return {
    network: parsed.network,
    signer,
    address: signer.getPublicKey().toSuiAddress(),
    signingPublicKey: signer.getPublicKey().toRawBytes(),
    encryptionSecret,
    encryptionPublicKey: x25519.getPublicKey(encryptionSecret),
  };
}

export function createDeviceEncryptionKeys() {
  const secret = randomBytes(32);
  return { secret, publicKey: x25519.getPublicKey(secret) };
}

/** Random nonce, explicit record context, and authenticated ciphertext.
 * The context should include org, record kind/id, revision and key version. */
export async function encryptContent(plaintext: Uint8Array, keyBytes: Uint8Array, context: string): Promise<Uint8Array> {
  checkKey(keyBytes);
  checkContext(context);
  if (plaintext.length > MAX_PLAINTEXT_BYTES) throw new Error('Content exceeds the 64 KiB record limit.');
  const nonce = randomBytes(12);
  const key = await globalThis.crypto.subtle.importKey('raw', arrayBuffer(keyBytes), 'AES-GCM', false, ['encrypt']);
  const ciphertext = await globalThis.crypto.subtle.encrypt({ name: 'AES-GCM', iv: arrayBuffer(nonce), additionalData: arrayBuffer(utf8.encode(context)), tagLength: 128 }, key, arrayBuffer(plaintext));
  return concat(DATA_MAGIC, nonce, new Uint8Array(ciphertext));
}

export async function decryptContent(envelope: Uint8Array, keyBytes: Uint8Array, context: string): Promise<Uint8Array> {
  checkKey(keyBytes);
  checkContext(context);
  checkEnvelope(envelope, DATA_MAGIC, 32, MAX_PLAINTEXT_BYTES + 32);
  const key = await globalThis.crypto.subtle.importKey('raw', arrayBuffer(keyBytes), 'AES-GCM', false, ['decrypt']);
  const plaintext = await globalThis.crypto.subtle.decrypt({ name: 'AES-GCM', iv: arrayBuffer(envelope.slice(4, 16)), additionalData: arrayBuffer(utf8.encode(context)), tagLength: 128 }, key, arrayBuffer(envelope.slice(16)));
  return new Uint8Array(plaintext);
}

/** Encrypt a keyring to a device or recovery public key. Publishers need only
 * the public key, so key rotation does not require the offline recovery code. */
export async function wrapKeys(plaintext: Uint8Array, recipientPublicKey: Uint8Array, context: string): Promise<Uint8Array> {
  checkKey(recipientPublicKey);
  checkContext(context);
  const ephemeral = randomBytes(32);
  const ephemeralPublic = x25519.getPublicKey(ephemeral);
  const salt = randomBytes(32);
  const shared = x25519.getSharedSecret(ephemeral, recipientPublicKey);
  const key = hkdf(sha256, shared, salt, utf8.encode(`fractalmind.key-wrap.v1:${context}`), 32);
  try {
    return concat(WRAP_MAGIC, ephemeralPublic, salt, await encryptContent(plaintext, key, context));
  } finally {
    ephemeral.fill(0); shared.fill(0); key.fill(0);
  }
}

export async function unwrapKeys(envelope: Uint8Array, recipientSecret: Uint8Array, context: string): Promise<Uint8Array> {
  checkKey(recipientSecret);
  checkContext(context);
  checkEnvelope(envelope, WRAP_MAGIC, 100, MAX_PLAINTEXT_BYTES + 100);
  const shared = x25519.getSharedSecret(recipientSecret, envelope.slice(4, 36));
  const key = hkdf(sha256, shared, envelope.slice(36, 68), utf8.encode(`fractalmind.key-wrap.v1:${context}`), 32);
  try { return await decryptContent(envelope.slice(68), key, context); }
  finally { shared.fill(0); key.fill(0); }
}

export function randomContentKey(): Uint8Array { return randomBytes(32); }

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0 || !/^[0-9a-f]*$/.test(hex)) throw new Error('Expected lowercase hexadecimal bytes.');
  return Uint8Array.from(hex.match(/../g) ?? [], (byte) => Number.parseInt(byte, 16));
}

function randomBytes(length: number): Uint8Array { return globalThis.crypto.getRandomValues(new Uint8Array(length)); }
function checkKey(key: Uint8Array): void { if (key.length !== 32) throw new Error('Expected a 32-byte key.'); }
function checkContext(context: string): void { if (!context || utf8.encode(context).length > 1024) throw new Error('A bounded encryption context is required.'); }
function arrayBuffer(bytes: Uint8Array): ArrayBuffer { return Uint8Array.from(bytes).buffer; }
function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
}
function checkEnvelope(bytes: Uint8Array, magic: Uint8Array, min: number, max: number): void {
  if (bytes.length < min || bytes.length > max || !magic.every((b, i) => bytes[i] === b)) throw new Error('Invalid encrypted envelope.');
}
