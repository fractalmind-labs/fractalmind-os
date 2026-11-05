import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import type { Deployment, Profile } from './types.js';

export const configDir = () => process.env.FM_CONFIG_DIR
  ?? join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'fractalmind-cli');

async function privateDir(path: string) {
  await mkdir(path, { recursive: true, mode: 0o700 });
}

export async function writePrivateJson(path: string, value: unknown) {
  await privateDir(dirname(path));
  const temporary = join(dirname(path), `.${basename(path)}.${process.pid}.${Date.now()}.tmp`);
  await writeFile(temporary, `${JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? item.toString() : item, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await rename(temporary, path);
}

export async function readJson<T>(path: string): Promise<T | null> {
  try { return JSON.parse(await readFile(path, 'utf8')) as T; }
  catch (error: unknown) {
    if (typeof error === 'object' && error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }
}

export const profilePath = (network: string) => join(configDir(), `profile-${network}.json`);
export const cachePath = (network: string, key: string) => join(configDir(), 'cache', network, `${key}.json`);

export async function loadProfile(network: string): Promise<Profile | null> {
  const profile = await readJson<Profile>(profilePath(network));
  if (!profile || profile.version !== 1 || profile.network !== network) return null;
  return profile;
}

export async function saveProfile(profile: Profile) { await writePrivateJson(profilePath(profile.network), profile); }
export async function removeProfile(network: string) { await rm(profilePath(network), { force: true }); }

/** Deployment data is explicitly supplied, or comes from the active profile.
 * The CLI never silently selects a live public network configuration. */
export async function loadDeployment(network: string, supplied?: string): Promise<Deployment | null> {
  const source = supplied ?? process.env.FM_DEPLOYMENT_FILE;
  const inline = process.env.FM_DEPLOYMENT;
  let raw: unknown = null;
  if (source) raw = await readJson<unknown>(source);
  else if (inline) raw = JSON.parse(inline);
  else raw = (await loadProfile(network))?.deployment ?? null;
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Partial<Deployment>;
  if (value.network !== network || typeof value.packageId !== 'string' || typeof value.registryId !== 'string') return null;
  return value as Deployment;
}

export async function readCache<T>(network: string, key: string): Promise<{ value: T; stale_since: string } | null> {
  return readJson<{ value: T; stale_since: string }>(cachePath(network, key));
}

export async function writeCache(network: string, key: string, value: unknown) {
  await writePrivateJson(cachePath(network, key), { value, stale_since: new Date().toISOString() });
}
