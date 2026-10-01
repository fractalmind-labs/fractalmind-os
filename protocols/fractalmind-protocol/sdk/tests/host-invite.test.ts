import assert from 'node:assert/strict';
import { createPublicKey, verify } from 'node:crypto';
import test from 'node:test';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { HostJoinIntentBcs, createHostInviteMaterial, encodeHostInviteCode, parseHostInviteCode } from '../src/host.js';
import { FractalMindSDK } from '../src/index.js';
import { SuiGrpcClient } from '@mysten/sui/grpc';

test('one invite code derives its proof key; corrupt checksums and networks fail', () => {
  const material = createHostInviteMaterial('localnet');
  const code = encodeHostInviteCode('localnet', '0x1234', material.entropy);
  assert.deepEqual(parseHostInviteCode(code, 'localnet').signer.getPublicKey().toRawBytes(), material.publicKey);
  material.entropy.fill(0);
  assert.deepEqual(parseHostInviteCode(code, 'localnet').signer.getPublicKey().toRawBytes(), material.publicKey);
  assert.throws(() => parseHostInviteCode(code, 'testnet'), /network/);
  const checksum = code.slice(-8);
  assert.throws(() => parseHostInviteCode(`${code.slice(0, -8)}${checksum[0] === '0' ? '1' : '0'}${checksum.slice(1)}`, 'localnet'), /checksum/);
});

test('invite proof signature binds sender, Host key, binding version, organization and expiry', async () => {
  const material = createHostInviteMaterial('localnet');
  const signer = parseHostInviteCode(encodeHostInviteCode('localnet', '0x1', material.entropy), 'localnet').signer;
  const host = Ed25519Keypair.generate();
  const value = {
    domain: new TextEncoder().encode('fractalmind.host-invite.v1'), invite_id: '0x1', org_id: '0x2', coordinator_binding: '0x3',
    binding_version: '1', host_address: host.getPublicKey().toSuiAddress(), host_public_key: host.getPublicKey().toRawBytes(),
    encryption_public_key: new Uint8Array(32).fill(4), proof_expires_at_ms: '1790825000000',
  };
  const message = HostJoinIntentBcs.serialize(value).toBytes();
  const signature = await signer.sign(message);
  const key = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(material.publicKey)]), format: 'der', type: 'spki' });
  assert.equal(verify(null, message, key, signature), true);
  for (const changes of [
    { host_address: '0x4' }, { host_public_key: new Uint8Array(32).fill(5) }, { binding_version: '2' },
    { org_id: '0x5' }, { proof_expires_at_ms: '1790825000001' }, { domain: new TextEncoder().encode('other-proof') },
  ]) assert.equal(verify(null, HostJoinIntentBcs.serialize({ ...value, ...changes }).toBytes(), key, signature), false);
});

test('a valid code for another network is rejected before any RPC request', async () => {
  const client = new SuiGrpcClient({ network: 'localnet', baseUrl: 'http://127.0.0.1:1' });
  assert.throws(() => new FractalMindSDK({ packageId: '0x42', network: 'mainnet', client }), /network/);
  const sdk = new FractalMindSDK({ packageId: '0x42', client });
  const material = createHostInviteMaterial('testnet');
  await assert.rejects(sdk.host.prepareJoin({ code: encodeHostInviteCode('testnet', '0x1', material.entropy), network: 'testnet', hostPublicKey: new Uint8Array(32), encryptionPublicKey: new Uint8Array(32), name: 'wrong network' }), /network/);
});
