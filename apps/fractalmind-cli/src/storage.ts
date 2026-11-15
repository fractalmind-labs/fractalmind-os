import { mkdir, open, readFile, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import type { TransactionJournal, TransactionJournalEntry } from '@fractalmind-labs/fractalmind-sdk';
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
export const journalPath = (network: string) => join(configDir(), 'journal', `${network}.json`);

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

type JournalFile = { format: 1; entries: TransactionJournalEntry[] };
const pendingGasConflict = (left: TransactionJournalEntry, right: TransactionJournalEntry) =>
  left.namespace === right.namespace && left.status === 'pending' && right.status === 'pending'
  && (left.addressGas && right.addressGas || left.gasReferences.some(ref => right.gasReferences.some(other => other.objectId === ref.objectId)));

/** Durable CLI journal.  It records only prepared digests and public gas
 * references; transaction bytes, signatures, keys, and encrypted payloads
 * never touch disk.  A small exclusive lock serializes two local CLI
 * processes, so a retry always queries its original digest instead of
 * rebuilding a transaction. */
export class FileTransactionJournal implements TransactionJournal {
  private readonly path: string;
  private readonly lock: string;
  constructor(network: string) { this.path = journalPath(network); this.lock = `${this.path}.lock`; }

  private async read(): Promise<JournalFile> {
    const value = await readJson<JournalFile>(this.path);
    if (!value) return { format: 1, entries: [] };
    if (value.format !== 1 || !Array.isArray(value.entries)) throw new Error('Invalid transaction journal.');
    return value;
  }

  async get(namespace: string, requestId: string) {
    const file = await this.read();
    const entry = file.entries.find(value => value.namespace === namespace && value.requestId === requestId);
    return entry ? structuredClone(entry) : undefined;
  }

  private async exclusive<T>(fn: () => Promise<T>): Promise<T | undefined> {
    await privateDir(dirname(this.path));
    let handle;
    try { handle = await open(this.lock, 'wx', 0o600); }
    catch (error: unknown) {
      if (typeof error === 'object' && error && 'code' in error && error.code === 'EEXIST') return undefined;
      throw error;
    }
    try { return await fn(); }
    finally { await handle.close(); await unlink(this.lock).catch(() => {}); }
  }

  async claim(entry: TransactionJournalEntry) {
    const result = await this.exclusive(async () => {
      const file = await this.read();
      if (file.entries.some(existing => existing.requestId === entry.requestId && existing.namespace === entry.namespace
        || pendingGasConflict(existing, entry))) return false;
      file.entries.push(structuredClone(entry));
      await writePrivateJson(this.path, file);
      return true;
    });
    return result ?? false;
  }

  async replace(entry: TransactionJournalEntry, expectedRevision: number) {
    const result = await this.exclusive(async () => {
      const file = await this.read();
      const index = file.entries.findIndex(existing => existing.namespace === entry.namespace && existing.requestId === entry.requestId);
      const current = index < 0 ? undefined : file.entries[index];
      if (!current || current.digest !== entry.digest || current.status !== 'pending' || current.revision !== expectedRevision) return false;
      file.entries[index] = structuredClone(entry);
      await writePrivateJson(this.path, file);
      return true;
    });
    return result ?? false;
  }
}
