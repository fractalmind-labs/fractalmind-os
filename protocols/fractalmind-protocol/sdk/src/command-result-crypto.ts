import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { normalizeSuiAddress } from '@mysten/sui/utils';
import { toBigInt } from './client.js';
import { encryptContent, decryptContent } from './identity-crypto.js';

const utf8 = new TextEncoder();
const domain = 'fractalmind.command-result-key.v1';
function fingerprint(value: string) {
  if (!/^[0-9a-f]{64}$/.test(value)) throw new Error('Expected a 32-byte command fingerprint.');
  return value;
}
function version(value: bigint | string | number) {
  const number = toBigInt(value);
  if (number === 0n) throw new Error('Result key version must be positive.');
  return number.toString();
}

/** A Host receives this derivative only, never the organization content key. */
export function commandResultKey(organizationKey: Uint8Array, organizationId: string, intentHash: string, keyVersion: bigint | string | number): Uint8Array {
  if (organizationKey.length !== 32) throw new Error('Expected a 32-byte organization key.');
  return hkdf(sha256, organizationKey, utf8.encode(domain), utf8.encode(`${domain}:${normalizeSuiAddress(organizationId)}:${fingerprint(intentHash)}:${version(keyVersion)}`), 32);
}

export function commandResultWrapContext(organizationId: string, capabilityId: string, membershipId: string, intentHash: string, keyVersion: bigint | string | number): string {
  return `fractalmind.command-result-wrap.v1:${normalizeSuiAddress(organizationId)}:${normalizeSuiAddress(capabilityId)}:${normalizeSuiAddress(membershipId)}:${fingerprint(intentHash)}:${version(keyVersion)}`;
}

/** FME2 distinguishes command-specific keys from legacy FME1 org-key bodies. */
export async function encryptCommandResult(plaintext: Uint8Array, derivedKey: Uint8Array, recordContext: string): Promise<Uint8Array> {
  const body = await encryptContent(plaintext, derivedKey, recordContext);
  body[3] = 50;
  return body;
}
export async function decryptCommandResult(body: Uint8Array, derivedKey: Uint8Array, recordContext: string): Promise<Uint8Array> {
  if (body.length < 32 || new TextDecoder().decode(body.slice(0, 4)) !== 'FME2') throw new Error('Invalid command result envelope.');
  const legacy = body.slice(); legacy[3] = 49;
  return decryptContent(legacy, derivedKey, recordContext);
}
