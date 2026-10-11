// App v2 (#75): one place for the connection, device session, chain data and
// preferences. Views read from here; protected actions still re-read the
// chain through their own flows.
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { DEVICE_ACTIONS } from "@fractalmind-labs/fractalmind-sdk";
import { normalizeProfile } from "../chain";
import { withBuiltInUpgrade } from "../deployments";
import { useChain } from "../use-chain";
import { useDeviceSession } from "../device-session";
import { useOkrTexts } from "../use-okr-texts";
import { clockNow, type ConnectionProfile, type OrganizationSnapshot } from "../domain";
import { loadCached, saveCached, clearCached, type CachedView, type Identity } from "./snapshot-cache";
import { LangProvider, type Lang, type Translate } from "./ui";

// The same storage keys as the first App, so switching keeps the connection
// and appearance.
const PROFILE_KEY = "fractalmind.app.public-connection.v1";
const PREFERENCE_KEY = "fractalmind.app.appearance.v1";
export type Theme = "system" | "light" | "dark";
export type Prefs = { language: Lang; theme: Theme };

function savedProfile() {
  try {
    const text = localStorage.getItem(PROFILE_KEY);
    return text ? withBuiltInUpgrade(normalizeProfile(JSON.parse(text))) : null;
  } catch {
    return null;
  }
}
function savedPrefs(): Prefs {
  try {
    const p = JSON.parse(localStorage.getItem(PREFERENCE_KEY) ?? "{}");
    return {
      language: p.language === "en" ? "en" : "zh",
      theme: ["light", "dark"].includes(p.theme) ? p.theme : "system",
    };
  } catch {
    return { language: "zh", theme: "system" };
  }
}

/** What this device may do in the organization, from its current chain grant. */
export type Permission = {
  read: boolean;
  operate: boolean;
  approve: boolean;
  manageHosts: boolean;
  expiresAtMs: number | null;
};

function useAppState() {
  const [prefs, setPrefs] = useState(savedPrefs);
  const [profile, setProfile] = useState<ConnectionProfile | null>(savedProfile);
  const [cached, setCached] = useState<CachedView | null>(() => (profile ? loadCached(profile) : null));
  const data = useChain(profile);
  const device = useDeviceSession();
  const [wallMs, setWallMs] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setWallMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Appearance and language, as the first App applies them.
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const theme = prefs.theme === "system" ? (media.matches ? "dark" : "light") : prefs.theme;
      document.documentElement.dataset.theme = theme;
      document.documentElement.lang = prefs.language === "zh" ? "zh-CN" : "en";
      if (isTauri()) void invoke("fm_app_appearance", { theme }).catch(() => {});
    };
    apply();
    media.addEventListener("change", apply);
    try {
      localStorage.setItem(PREFERENCE_KEY, JSON.stringify(prefs));
    } catch {
      /* optional */
    }
    return () => media.removeEventListener("change", apply);
  }, [prefs]);

  // A revoked device grant ends the session at once.
  const sessionAddress = device.session.state === "unlocked" ? device.session.device.address : null;
  const liveGrants = data.identity?.grants.value;
  useEffect(() => {
    if (
      sessionAddress &&
      liveGrants?.some((g) => g.device === sessionAddress) &&
      !liveGrants.some((g) => g.device === sessionAddress && !g.revoked)
    )
      void device.lock("revoked");
  }, [sessionAddress, liveGrants, device.lock]);

  // Keep the verified chain pin, and the last snapshot for an instant start.
  useEffect(() => {
    if (profile && data.identity?.human.id === profile.humanId) {
      try {
        localStorage.setItem(PROFILE_KEY, JSON.stringify({ ...profile, chainIdentifier: data.identity.chainIdentifier }));
      } catch {
        /* optional */
      }
    }
  }, [profile, data.identity?.human.id, data.identity?.chainIdentifier]);
  useEffect(() => {
    if (!profile || !data.identity) return;
    const view = { identity: data.identity, snapshot: data.snapshot, savedAtMs: Date.now() };
    saveCached(profile, view);
  }, [profile, data.identity, data.snapshot]);

  const identity: Identity | null = data.identity ?? cached?.identity ?? null;
  const organizationId = data.organizationId || cached?.snapshot?.organization.objectId || "";
  const cachedSnapshot =
    cached?.snapshot?.organization.objectId === organizationId ? cached.snapshot : null;
  const snapshot: OrganizationSnapshot | null = data.snapshot ?? cachedSnapshot;
  /** When the shown snapshot is the cached one, its sync time. */
  const staleSince = !data.snapshot && cachedSnapshot ? cached!.savedAtMs : null;

  const deviceProfile = device.session.state === "unlocked" ? device.session.profile : null;
  const permission: Permission | null = useMemo(() => {
    const grants = identity?.grants.value;
    if (!sessionAddress || !grants || !organizationId || !identity) return null;
    const clock = identity.clockMs + BigInt(Math.max(0, wallMs - identity.loadedAtMs));
    const mine = grants.filter(
      (g) =>
        g.device === sessionAddress &&
        !g.revoked &&
        g.generation === identity.human.generation &&
        BigInt(g.expires_at_ms) > clock &&
        (g.org_scope === null || g.org_scope === organizationId),
    );
    const has = (a: number) => mine.some((g) => g.actions.includes(a));
    const expires = mine.map((g) => Number(g.expires_at_ms)).sort((a, b) => a - b)[0] ?? null;
    return {
      read: has(DEVICE_ACTIONS.read),
      operate: has(DEVICE_ACTIONS.operate),
      approve: has(DEVICE_ACTIONS.approve),
      manageHosts: has(DEVICE_ACTIONS.manage_hosts),
      expiresAtMs: expires,
    };
  }, [identity, sessionAddress, organizationId, Math.floor(wallMs / 60000)]);

  const okrTexts = useOkrTexts(
    device.session,
    profile,
    snapshot?.organization.objectId,
    snapshot?.okrs.value,
    identity?.grants.value,
  );
  const now = snapshot ? clockNow(snapshot, wallMs) : BigInt(wallMs);
  const hostAuthorityRevision = JSON.stringify([
    data.reachable,
    identity?.human.generation,
    identity?.grants.value?.map((g) => [g.id, g.version, g.revoked, g.generation, g.expires_at_ms]),
    snapshot?.bindings.value,
    snapshot?.hosts.value?.map((row) => [
      row.address,
      row.current.value?.id,
      row.current.value?.version,
      row.current.value?.revoked,
      row.current.value?.expires_at_ms,
      row.current.failure,
    ]),
  ]);
  const t: Translate = (zh, en) => (prefs.language === "zh" ? zh : en);
  const profileWithChain = profile
    ? { ...profile, chainIdentifier: identity?.chainIdentifier ?? profile.chainIdentifier }
    : null;

  return {
    prefs,
    setPrefs,
    t,
    profile: profileWithChain,
    connect(value: ConnectionProfile) {
      void device.resync();
      setProfile(value);
      setCached(loadCached(value));
      try {
        localStorage.setItem(PROFILE_KEY, JSON.stringify(value));
      } catch {
        /* optional */
      }
    },
    disconnect() {
      setProfile(null);
      setCached(null);
      clearCached();
      try {
        localStorage.removeItem(PROFILE_KEY);
      } catch {
        /* optional */
      }
    },
    device,
    deviceProfile,
    chain: data,
    identity,
    organizationId,
    selectOrganization: data.selectOrganization,
    snapshot,
    staleSince,
    refresh: data.refresh,
    reachable: data.reachable,
    permission,
    okrTexts,
    now,
    wallMs,
    hostAuthorityRevision,
  };
}

export type AppState = ReturnType<typeof useAppState>;
const AppContext = createContext<AppState | null>(null);
export function AppProvider({ children }: { children: (app: AppState) => ReactNode }) {
  const app = useAppState();
  return (
    <AppContext.Provider value={app}>
      <LangProvider value={app.prefs.language}>{children(app)}</LangProvider>
    </AppContext.Provider>
  );
}
export function useApp() {
  const app = useContext(AppContext);
  if (!app) throw new Error("useApp outside AppProvider");
  return app;
}
