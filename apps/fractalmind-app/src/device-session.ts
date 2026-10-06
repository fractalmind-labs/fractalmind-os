import { useCallback, useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  call,
  DEVICE_LOCKED_EVENT,
  NativeDeviceError,
  preferredDeviceProfile,
  publicResult,
  type DevicePublic,
  type NativeInvoke,
} from "./native-device";

/** Native session state. Never contains key material. */
export type SessionStatus = Readonly<{
  profile: string;
  unlocked: boolean;
  idleTimeoutMs: number;
  remainingMs: number;
}>;
export type LockReason = "manual" | "idle" | "background" | "revoked" | "error";
export type DeviceSession =
  /** Browser preview: there are no device keys to unlock. */
  | { state: "web" }
  | { state: "checking" }
  /** No device keys on this machine; the App stays a read-only browser. */
  | { state: "no_device"; profile: string }
  | { state: "unlocking"; profile: string }
  | { state: "locked"; profile: string; reason: LockReason }
  | {
      state: "unlocked";
      profile: string;
      device: DevicePublic;
      idleTimeoutMs: number;
      remainingMs: number;
    };

export const IDLE_CHOICES_MINUTES = [5, 15, 30, 60] as const;
const DEFAULT_IDLE_MINUTES = 15;
const LOCK_PREFERENCE_KEY = "fractalmind.app.lock.v1";
/** Phones lock after this long in the background. */
export const BACKGROUND_LOCK_MS = 60_000;
const POLL_MS = 30_000;
const TOUCH_THROTTLE_MS = 60_000;

export function savedIdleMinutes(): number {
  try {
    const value = JSON.parse(localStorage.getItem(LOCK_PREFERENCE_KEY) ?? "{}")
      ?.idleMinutes;
    if ((IDLE_CHOICES_MINUTES as readonly number[]).includes(value))
      return value;
  } catch {}
  return DEFAULT_IDLE_MINUTES;
}
function saveIdleMinutes(minutes: number) {
  try {
    localStorage.setItem(
      LOCK_PREFERENCE_KEY,
      JSON.stringify({ idleMinutes: minutes }),
    );
  } catch {
    /* A preference only; the native default still applies. */
  }
}

export function sessionStatusResult(
  value: unknown,
  profile: string,
): SessionStatus {
  const v = value as Record<string, unknown> | null;
  const ms = (n: unknown) =>
    typeof n === "number" && Number.isSafeInteger(n) && n >= 0;
  if (
    !v ||
    typeof v !== "object" ||
    v.profile !== profile ||
    typeof v.unlocked !== "boolean" ||
    !ms(v.idleTimeoutMs) ||
    !ms(v.remainingMs)
  )
    throw new NativeDeviceError("invalid_response");
  return Object.freeze({
    profile,
    unlocked: v.unlocked,
    idleTimeoutMs: v.idleTimeoutMs as number,
    remainingMs: v.remainingMs as number,
  });
}

/** Whether returning to a hidden App should lock it. Desktops rely on the
 * native idle timeout; phones also lock after a short time in the background. */
export function lockAfterHidden(hiddenMs: number, mobile: boolean) {
  return mobile && hiddenMs >= BACKGROUND_LOCK_MS;
}

const isMobile = () =>
  typeof navigator !== "undefined" &&
  /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
const defaultTransport: NativeInvoke = (command, args) => invoke(command, args);

/** One unlock per sign-in: device keys stay in native memory until the App is
 * locked, idles out or (on phones) stays in the background. */
export function useDeviceSession(transport: NativeInvoke = defaultTransport) {
  const native = isTauri();
  const [session, setSession] = useState<DeviceSession>(
    native ? { state: "checking" } : { state: "web" },
  );
  const [idleMinutes, setIdleMinutesState] = useState(savedIdleMinutes);
  const profile = useRef(preferredDeviceProfile());
  const inFlight = useRef(false);
  const lastTouch = useRef(0);

  const unlocked = useCallback(
    async (device?: DevicePublic) => {
      const p = profile.current;
      const status = sessionStatusResult(
        await call(transport, "fm_device_session", { profile: p }),
        p,
      );
      if (!status.unlocked) throw new NativeDeviceError("locked");
      const pub =
        device ??
        publicResult(await call(transport, "fm_device_public", { profile: p }), p);
      setSession({
        state: "unlocked",
        profile: p,
        device: pub,
        idleTimeoutMs: status.idleTimeoutMs,
        remainingMs: status.remainingMs,
      });
    },
    [transport],
  );

  const unlock = useCallback(async () => {
    if (!native || inFlight.current) return;
    inFlight.current = true;
    const p = (profile.current = preferredDeviceProfile());
    setSession({ state: "unlocking", profile: p });
    try {
      await call(transport, "fm_device_set_idle_timeout", {
        ms: String(savedIdleMinutes() * 60_000),
      }).catch(() => undefined);
      const device = publicResult(
        await call(transport, "fm_device_unlock", { profile: p }),
        p,
      );
      lastTouch.current = Date.now();
      await unlocked(device);
    } catch (error) {
      setSession(
        error instanceof NativeDeviceError && error.code === "not_initialized"
          ? { state: "no_device", profile: p }
          : { state: "locked", profile: p, reason: "error" },
      );
    } finally {
      inFlight.current = false;
    }
  }, [native, transport, unlocked]);

  const lock = useCallback(
    async (reason: LockReason = "manual") => {
      if (!native) return;
      try {
        await call(transport, "fm_device_lock", {});
      } catch {
        /* The UI locks regardless; the next operation re-checks natively. */
      }
      setSession((s) =>
        s.state === "web" || s.state === "no_device"
          ? s
          : { state: "locked", profile: profile.current, reason },
      );
    },
    [native, transport],
  );

  /** After a failed unlock, keep using the App as a read-only browser. */
  const browseReadOnly = useCallback(() => {
    setSession((s) =>
      s.state === "locked" ? { state: "no_device", profile: s.profile } : s,
    );
  }, []);

  const setIdleMinutes = useCallback(
    async (minutes: number) => {
      if (!(IDLE_CHOICES_MINUTES as readonly number[]).includes(minutes)) return;
      saveIdleMinutes(minutes);
      setIdleMinutesState(minutes);
      if (!native) return;
      await call(transport, "fm_device_set_idle_timeout", {
        ms: String(minutes * 60_000),
      }).catch(() => undefined);
      if (session.state === "unlocked") await unlocked(session.device).catch(() => undefined);
    },
    [native, transport, session, unlocked],
  );

  // Sign-in: reuse a live native session (e.g. after a WebView reload),
  // otherwise unlock once.
  useEffect(() => {
    if (!native) return;
    let cancelled = false;
    void (async () => {
      try {
        await unlocked();
      } catch {
        if (!cancelled) await unlock();
      }
    })();
    return () => {
      cancelled = true;
    };
    // Runs once per App start; later unlocks are explicit.
  }, []);

  const isUnlocked = session.state === "unlocked";
  const watching = isUnlocked || session.state === "no_device";
  // Poll status (no OS-store access, no extension) to notice idle expiry, and
  // a session started by creating or recovering a device in this App.
  useEffect(() => {
    if (!watching) return;
    const timer = setInterval(() => {
      void call(transport, "fm_device_session", { profile: profile.current })
        .then((value) => {
          const status = sessionStatusResult(value, profile.current);
          if (status.unlocked && !isUnlocked) void unlocked().catch(() => undefined);
          else if (!status.unlocked && isUnlocked)
            setSession({ state: "locked", profile: profile.current, reason: "idle" });
          else if (status.unlocked)
            setSession((s) =>
              s.state === "unlocked"
                ? { ...s, remainingMs: status.remainingMs, idleTimeoutMs: status.idleTimeoutMs }
                : s,
            );
        })
        .catch(() => undefined);
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [watching, isUnlocked, transport, unlocked]);

  // User activity keeps an attended session open (throttled).
  useEffect(() => {
    if (!isUnlocked) return;
    const activity = () => {
      if (Date.now() - lastTouch.current < TOUCH_THROTTLE_MS) return;
      lastTouch.current = Date.now();
      void call(transport, "fm_device_touch", { profile: profile.current }).catch(
        () => undefined,
      );
    };
    window.addEventListener("pointerdown", activity, { passive: true });
    window.addEventListener("keydown", activity);
    return () => {
      window.removeEventListener("pointerdown", activity);
      window.removeEventListener("keydown", activity);
    };
  }, [isUnlocked, transport]);

  // Any native operation that found the session locked.
  useEffect(() => {
    if (!native) return;
    const onLocked = () =>
      setSession((s) =>
        s.state === "unlocked" || s.state === "checking"
          ? { state: "locked", profile: profile.current, reason: "idle" }
          : s,
      );
    window.addEventListener(DEVICE_LOCKED_EVENT, onLocked);
    return () => window.removeEventListener(DEVICE_LOCKED_EVENT, onLocked);
  }, [native]);

  // Phones lock after a while in the background.
  useEffect(() => {
    if (!isUnlocked) return;
    let hiddenAt = 0;
    const visibility = () => {
      if (document.visibilityState === "hidden") hiddenAt = Date.now();
      else if (hiddenAt && lockAfterHidden(Date.now() - hiddenAt, isMobile()))
        void lock("background");
    };
    document.addEventListener("visibilitychange", visibility);
    return () => document.removeEventListener("visibilitychange", visibility);
  }, [isUnlocked, lock]);

  return { session, unlock, lock, browseReadOnly, idleMinutes, setIdleMinutes };
}
