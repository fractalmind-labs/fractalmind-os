import { randomUUID } from 'node:crypto';
import { bcs } from '@mysten/sui/bcs';
import { requestSuiFromFaucetV2 } from '@mysten/sui/faucet';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { normalizeSuiAddress, toBase64 } from '@mysten/sui/utils';
import { createDeviceEncryptionKeys, DEVICE_ACTIONS, FractalMindSDK, pairingCode, pairingFingerprint, type DeviceAction } from '@fractalmind-labs/fractalmind-sdk';
import { deleteKey, loadKey, saveKey } from './keystore.js';
import { EXIT, FmError } from './output.js';
import { loadProfile, removeProfile, saveProfile } from './storage.js';
import type { Deployment, Profile } from './types.js';

const ID = bcs.Address;
const ClockBcs = bcs.struct('Clock', { id: ID, timestamp_ms: bcs.u64() });
const READ = 1;

function isMissing(error: unknown) {
  return !!error && typeof error === 'object' && 'reason' in error && error.reason === 'notFound';
}

export type Authorization = {
  sdk: FractalMindSDK;
  profile: Profile;
  human: Awaited<ReturnType<FractalMindSDK['identity']['getHuman']>>;
  grant: Awaited<ReturnType<FractalMindSDK['identity']['getDeviceGrant']>>;
  operator: Awaited<ReturnType<FractalMindSDK['identity']['getAgentOperator']>>;
  now: bigint;
};

/** Pure portion of the on-chain grant check, kept independently testable.
 * Operator metadata is checked immediately after this function in authorize. */
export function evaluateGrant(input: {
  profile: Pick<Profile, 'network' | 'humanId' | 'grantId' | 'organizationId' | 'address'>;
  human: { id: string; network: string; organizations: string[]; grants: string[]; generation: string };
  grant: { revoked: boolean; expires_at_ms: string; human_id: string; device: string; org_scope: string | null; generation: string; actions: number[] };
  organizationActive: boolean;
  now: bigint;
  required: DeviceAction;
}) {
  const { profile, human, grant, organizationActive, now, required } = input;
  const humanId = asAddress(profile.humanId), grantId = asAddress(profile.grantId!), organizationId = asAddress(profile.organizationId);
  if (human.id !== humanId || human.network !== profile.network || !human.organizations.includes(organizationId)
    || !human.grants.includes(grantId) || !organizationActive) {
    throw new FmError(EXIT.not_authorized, 'not_authorized', 'The profile no longer matches this Human and organization.');
  }
  if (grant.revoked || BigInt(grant.expires_at_ms) <= now) {
    throw new FmError(EXIT.revoked_or_expired, 'revoked_or_expired', grant.revoked ? 'The Agent grant was revoked.' : 'The Agent grant expired.');
  }
  if (grant.human_id !== humanId || grant.device !== asAddress(profile.address) || grant.org_scope !== organizationId
    || grant.generation !== human.generation || !grant.actions.includes(READ)
    || !grant.actions.includes(DEVICE_ACTIONS[required])) {
    throw new FmError(EXIT.not_authorized, 'not_authorized', `Grant does not permit ${required}.`);
  }
}

export function sdkFor(deployment: Deployment) {
  return new FractalMindSDK({
    packageId: deployment.packageId, registryId: deployment.registryId, network: deployment.network,
    fullnodeUrl: deployment.fullnodeUrl, originalPackageId: deployment.originalPackageId,
    okrPackageId: deployment.okrPackageId, originalOkrPackageId: deployment.originalOkrPackageId,
    directPackageId: deployment.directPackageId, originalDirectPackageId: deployment.originalDirectPackageId,
  });
}

function asAddress(value: string): string {
  try { return normalizeSuiAddress(value); }
  catch { throw new FmError(EXIT.not_found, 'not_found', `Invalid object id: ${value}`); }
}

async function nowOnChain(sdk: FractalMindSDK) {
  const { object } = await sdk.client.client.core.getObject({ objectId: '0x6', include: { content: true } });
  if (!object.content) throw new Error('Chain Clock content is missing.');
  return BigInt(ClockBcs.parse(object.content).timestamp_ms);
}

/** Every read calls this again.  The local profile and cache can identify a
 * request, but neither can ever authorize the agent. */
export async function authorize(network: string, required: DeviceAction = 'read'): Promise<Authorization> {
  const profile = await loadProfile(network);
  if (!profile) throw new FmError(EXIT.not_authorized, 'not_authorized', 'No local Agent profile. Run fm auth login.');
  const stored = await loadKey(profile.keyRef);
  if (!stored.key) throw new FmError(EXIT.not_authorized, 'not_authorized', 'The local Agent key is unavailable; run fm auth login again.');
  const sdk = sdkFor(profile.deployment);
  // A direct RPC check is intentionally first; a stale cache never bypasses it.
  await sdk.client.client.core.getChainIdentifier();
  if (!profile.grantId) throw new FmError(EXIT.not_authorized, 'not_authorized', 'Pairing is still pending human approval.');
  const [human, grant, org, now] = await Promise.all([
    sdk.identity.getHuman(profile.humanId), sdk.identity.getDeviceGrant(profile.grantId),
    sdk.organization.getOrganization(profile.organizationId), nowOnChain(sdk),
  ]);
  const grantId = asAddress(profile.grantId), organizationId = asAddress(profile.organizationId);
  if (org.objectId !== organizationId) throw new FmError(EXIT.not_authorized, 'not_authorized', 'Organization object id changed unexpectedly.');
  evaluateGrant({ profile, human, grant, organizationActive: org.isActive, now, required });
  let operator: Awaited<ReturnType<FractalMindSDK['identity']['getAgentOperator']>>;
  try { operator = await sdk.identity.getAgentOperator(grantId); }
  catch (error) {
    if (isMissing(error)) throw new FmError(EXIT.not_authorized, 'not_authorized', 'Grant is not an Agent Operator grant.');
    throw error;
  }
  return { sdk, profile, human, grant, operator, now };
}

export async function balance(sdk: FractalMindSDK, address: string) {
  const response = await sdk.client.client.core.getBalance({ owner: address, coinType: '0x2::sui::SUI' });
  return BigInt(response.balance.balance);
}

function localFaucet(network: string) {
  if (network !== 'localnet') throw new FmError(EXIT.usage, 'usage', '--faucet is supported only on localnet.');
  const host = process.env.FM_LOCALNET_FAUCET ?? 'http://127.0.0.1:9123';
  if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(host).hostname))
    throw new FmError(EXIT.usage, 'usage', 'FM_LOCALNET_FAUCET must be a localhost URL.');
  return host;
}

async function waitForSpendableFunds(sdk: FractalMindSDK, address: string) {
  const deadline = Date.now() + 20_000;
  while (true) {
    try {
      const coins = await sdk.client.client.core.listCoins({ owner: address });
      for (const coin of coins.objects) {
        if (BigInt(coin.balance) > 0n) {
          const current = await sdk.client.client.core.getObject({ objectId: coin.objectId });
          if (current.object.objectId === coin.objectId) return;
        }
      }
    } catch { /* Faucet/index lag is retried without creating another request. */ }
    if (Date.now() >= deadline) throw new Error('Localnet faucet funds did not become spendable within 20 seconds.');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}

export type LoginOptions = { organization: string; label?: string; noWait?: boolean; faucet?: boolean; waitSeconds?: number };
export type LoginResult = { address: string; needs_funding?: boolean; requestId?: string; pairingCode?: string; state: 'needs_funding' | 'pending' | 'approved' };

function platform(): 'macos' | 'windows' | 'ubuntu' {
  return process.platform === 'darwin' ? 'macos' : process.platform === 'win32' ? 'windows' : 'ubuntu';
}

function transactionData(result: Awaited<ReturnType<FractalMindSDK['client']['signAndExecuteTransaction']>>) {
  return result.$kind === 'Transaction' ? result.Transaction : result.FailedTransaction;
}

/** A transaction receipt can arrive just before the read node exposes its
 * newly shared object.  This retries only the exact known output id; it never
 * rebuilds or resubmits the transaction. */
async function visiblePairing(sdk: FractalMindSDK, requestId: string) {
  const deadline = Date.now() + 20_000;
  let last: unknown;
  while (Date.now() < deadline) {
    try { return await sdk.identity.getDevicePairing(requestId); }
    catch (error) { last = error; await new Promise(resolve => setTimeout(resolve, 100)); }
  }
  throw new Error(`Pairing request ${requestId} was confirmed but did not become readable.`, { cause: last });
}

export async function login(deployment: Deployment, options: LoginOptions): Promise<{ result: LoginResult; weaker: boolean }> {
  const sdk = sdkFor(deployment);
  await sdk.client.client.core.getChainIdentifier();
  let organizationId: string;
  if (/^0x[0-9a-fA-F]+$/.test(options.organization)) organizationId = asAddress(options.organization);
  else {
    const found = await sdk.organization.findByName(options.organization.trim(), deployment.registryId);
    if (!found.organizationId) throw new FmError(EXIT.not_found, 'not_found', `Organization ${JSON.stringify(options.organization.trim())} was not found.`);
    organizationId = found.organizationId;
  }
  const organization = await sdk.organization.getOrganization(organizationId);
  const humanId = organization.admin;
  const human = await sdk.identity.getHuman(humanId);
  if (human.network !== deployment.network || !human.organizations.includes(organizationId))
    throw new FmError(EXIT.not_authorized, 'not_authorized', 'The organization is not backed by a valid Human identity.');
  const signer = Ed25519Keypair.generate();
  const address = signer.getPublicKey().toSuiAddress();
  if (options.faucet) {
    await requestSuiFromFaucetV2({ host: localFaucet(deployment.network), recipient: address });
    await waitForSpendableFunds(sdk, address);
  }
  if (await balance(sdk, address) === 0n) return { result: { address, needs_funding: true, state: 'needs_funding' }, weaker: Boolean(process.env.FM_KEY_PASSPHRASE) };
  const encryption = createDeviceEncryptionKeys();
  const label = options.label?.trim() || 'FractalMind Agent';
  const request = sdk.identity.createAgentPairing({
    humanId, organizationId, signingPublicKey: signer.getPublicKey().toRawBytes(), encryptionPublicKey: encryption.publicKey,
    deviceName: label, platform: platform(),
  });
  request.setSender(address);
  request.setGasBudget(200_000_000);
  const submitted = transactionData(await sdk.client.signAndExecuteTransaction({ signer, transaction: request, include: { effects: true, objectTypes: true } }));
  if (!submitted.status.success) throw new Error(`Pairing transaction failed: ${submitted.status.error ?? 'unknown error'}`);
  const requestType = await sdk.client.coreType('identity', 'DevicePairingRequest');
  const requestIds = Object.entries(submitted.objectTypes ?? {}).filter(([, type]) => type === requestType).map(([id]) => id);
  if (requestIds.length !== 1) throw new Error('Pairing transaction did not create exactly one DevicePairingRequest.');
  const requestId = requestIds[0]!;
  const pair = await visiblePairing(sdk, requestId);
  const chain = (await sdk.client.client.core.getChainIdentifier()).chainIdentifier;
  const keyRef = randomUUID();
  const saved = await saveKey(keyRef, { signingSecret: signer.getSecretKey(), encryptionSecret: toBase64(encryption.secret), encryptionPublicKey: toBase64(encryption.publicKey) });
  const profile: Profile = { version: 1, network: deployment.network, deployment, address, keyRef, label, organizationId, humanId, requestId, createdAt: new Date().toISOString() };
  await saveProfile(profile);
  const code = pairingCode(await pairingFingerprint(chain, pair));
  const result: LoginResult = { address, requestId, pairingCode: code, state: 'pending' };
  if (!options.noWait) return { result: await waitForPairing(profile, options.waitSeconds ?? 600, code), weaker: saved.weaker };
  return { result, weaker: saved.weaker };
}

export async function waitForPairing(profile: Profile, seconds: number, code?: string): Promise<LoginResult> {
  const sdk = sdkFor(profile.deployment);
  const deadline = Date.now() + Math.max(1, seconds) * 1000;
  while (true) {
    if (!profile.requestId) throw new Error('Missing pairing request id.');
    const pair = await visiblePairing(sdk, profile.requestId);
    if (pair.status === 1 && pair.grant_id) {
      profile.grantId = pair.grant_id; await saveProfile(profile);
      return { address: profile.address, requestId: profile.requestId, pairingCode: code, state: 'approved' };
    }
    if (pair.status !== 0) throw new FmError(EXIT.not_authorized, 'not_authorized', 'The pairing request was rejected or cancelled.');
    if (Date.now() >= deadline) return { address: profile.address, requestId: profile.requestId, pairingCode: code, state: 'pending' };
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}

export async function status(network: string) {
  const profile = await loadProfile(network);
  if (!profile) throw new FmError(EXIT.not_found, 'not_found', 'No local Agent profile.');
  const sdk = sdkFor(profile.deployment);
  await sdk.client.client.core.getChainIdentifier();
  if (!profile.grantId) {
    const pair = profile.requestId ? await visiblePairing(sdk, profile.requestId) : null;
    if (pair?.status === 1 && pair.grant_id) { profile.grantId = pair.grant_id; await saveProfile(profile); }
    else return { address: profile.address, organizationId: profile.organizationId, requestId: profile.requestId, state: 'pending' };
  }
  const [grant, total] = await Promise.all([sdk.identity.getDeviceGrant(profile.grantId!), balance(sdk, profile.address)]);
  return { address: profile.address, grantId: profile.grantId, organizationId: profile.organizationId, actions: readableActions(grant.actions), expiresAtMs: grant.expires_at_ms, revoked: grant.revoked, balance: total.toString() };
}

export async function logout(network: string) {
  const profile = await loadProfile(network);
  if (!profile) throw new FmError(EXIT.not_found, 'not_found', 'No local Agent profile.');
  await deleteKey(profile.keyRef); await removeProfile(network);
  return { loggedOut: true, network };
}

export const readableActions = (actions: readonly number[]) => actions.map(value => ({ 1: 'read', 2: 'operate', 3: 'approve', 4: 'manage_hosts' }[value] ?? `unknown:${value}`));
