// App v2 (#75): the last organization snapshot, kept only so the App can show
// something at once while the chain is read again. It is display data: every
// action re-reads the chain, and the UI marks it with its sync time until the
// fresh snapshot arrives. Never used for authority.
import type { ChainReadSession } from "../chain";
import type { ConnectionProfile, OrganizationSnapshot } from "../domain";

export type Identity = Awaited<ReturnType<ChainReadSession["human"]>>;
export type CachedView = {
  identity: Identity;
  snapshot: OrganizationSnapshot | null;
  savedAtMs: number;
};
const KEY = "fractalmind.v2.snapshot.v1";
const MAX_BYTES = 2_000_000;

/** JSON with bigint and byte arrays tagged so they round-trip exactly. */
export function encode(value: unknown) {
  return JSON.stringify(value, (_, v) => {
    if (typeof v === "bigint") return { $bigint: v.toString() };
    if (v instanceof Uint8Array) return { $bytes: Array.from(v) };
    return v;
  });
}
export function decode<T>(text: string): T {
  return JSON.parse(text, (_, v) => {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const keys = Object.keys(v);
      if (keys.length === 1 && keys[0] === "$bigint" && typeof v.$bigint === "string") return BigInt(v.$bigint);
      if (keys.length === 1 && keys[0] === "$bytes" && Array.isArray(v.$bytes)) return Uint8Array.from(v.$bytes);
    }
    return v;
  }) as T;
}

const scope = (profile: ConnectionProfile) =>
  JSON.stringify([profile.network, profile.registryId, profile.humanId]);

export function loadCached(profile: ConnectionProfile, storage: Pick<Storage, "getItem"> = localStorage) {
  try {
    const text = storage.getItem(KEY);
    if (!text) return null;
    const value = decode<{ scope: string; view: CachedView }>(text);
    // Another identity's cache is never shown.
    return value.scope === scope(profile) ? value.view : null;
  } catch {
    return null;
  }
}

export function saveCached(
  profile: ConnectionProfile,
  view: CachedView,
  storage: Pick<Storage, "setItem" | "removeItem"> = localStorage,
) {
  try {
    const text = encode({ scope: scope(profile), view });
    if (text.length > MAX_BYTES) storage.removeItem(KEY);
    else storage.setItem(KEY, text);
  } catch {
    /* The cache is optional; a full or blocked store just means no instant view. */
  }
}

export function clearCached(storage: Pick<Storage, "removeItem"> = localStorage) {
  try {
    storage.removeItem(KEY);
  } catch {
    /* optional */
  }
}
