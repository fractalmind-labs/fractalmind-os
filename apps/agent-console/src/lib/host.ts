export type CheckState = "pass" | "fail" | "unknown" | "unsupported";

export interface Check {
  state: CheckState;
  message: string;
  detail?: string | null;
}

export interface PermissionCheck extends Check {
  label: string;
  settingsUrl: string;
}

export interface MacosPermissions {
  platform: string;
  screenRecording: PermissionCheck;
  accessibility: PermissionCheck;
}

export interface HostPaths {
  appInstallPath: string;
  appSupportDir: string;
  helperDir: string;
  launchAgentPath: string;
  rollbackDir: string;
}

export interface HostStatus {
  productName: string;
  bundleId: string;
  launchAgentLabel: string;
  paths: HostPaths;
  helperSource: Check;
  helperInstalled: Check;
  workerRunning: Check;
  workerAuthenticated: Check;
  desktopHealth: Check;
  mediaStatus: Check;
  orphanFfmpeg: Check;
}

export interface HostOperationResult {
  success: boolean;
  code: string;
  message: string;
}

export const SCREEN_RECORDING_SETTINGS_URL =
  "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture";
export const ACCESSIBILITY_SETTINGS_URL =
  "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility";

export function checkLabel(state: CheckState): string {
  switch (state) {
    case "pass":
      return "PASS";
    case "fail":
      return "FAIL";
    case "unsupported":
      return "N/A";
    case "unknown":
      return "UNKNOWN";
  }
}

export function hostVerified(status: HostStatus, permissions: MacosPermissions): boolean {
  return (
    permissions.screenRecording.state === "pass" &&
    permissions.accessibility.state === "pass" &&
    status.helperInstalled.state === "pass" &&
    status.workerRunning.state === "pass" &&
    status.workerAuthenticated.state === "pass" &&
    status.desktopHealth.state === "pass" &&
    status.orphanFfmpeg.state === "pass"
  );
}

export function helperInstallAvailable(status: HostStatus): boolean {
  return status.helperSource.state === "pass";
}

export function fallbackPermissions(): MacosPermissions {
  return {
    platform: "web",
    screenRecording: {
      state: "unsupported",
      label: "Screen Recording",
      settingsUrl: SCREEN_RECORDING_SETTINGS_URL,
      message: "Open FractalMind.app on macOS to read native TCC status.",
    },
    accessibility: {
      state: "unsupported",
      label: "Accessibility",
      settingsUrl: ACCESSIBILITY_SETTINGS_URL,
      message: "Open FractalMind.app on macOS to read native TCC status.",
    },
  };
}

export function fallbackHostStatus(): HostStatus {
  const unsupported: Check = {
    state: "unsupported",
    message: "Open FractalMind.app on macOS to read this host status.",
  };
  return {
    productName: "FractalMind",
    bundleId: "ai.fractalmind.app",
    launchAgentLabel: "ai.fractalmind.host",
    paths: {
      appInstallPath: "/Applications/FractalMind.app",
      appSupportDir: "~/Library/Application Support/FractalMind/Host",
      helperDir: "~/Library/Application Support/FractalMind/Host/current",
      launchAgentPath: "~/Library/LaunchAgents/ai.fractalmind.host.plist",
      rollbackDir: "~/Library/Application Support/FractalMind/Host/rollback",
    },
    helperSource: {
      state: "fail",
      message: "No deterministic helper bundle is available in the web build.",
    },
    helperInstalled: unsupported,
    workerRunning: unsupported,
    workerAuthenticated: unsupported,
    desktopHealth: unsupported,
    mediaStatus: unsupported,
    orphanFfmpeg: unsupported,
  };
}

export async function getMacosPermissions(): Promise<MacosPermissions> {
  return invokeOrFallback("get_macos_permissions", undefined, fallbackPermissions());
}

export async function openPermissionSettings(kind: "screen_recording" | "accessibility"): Promise<HostOperationResult> {
  try {
    await invokeNative("open_macos_permission_settings", { kind });
    return { success: true, code: "opened", message: "System Settings opened." };
  } catch (e) {
    return { success: false, code: "open_failed", message: (e as Error).message };
  }
}

export async function getHostStatus(): Promise<HostStatus> {
  return invokeOrFallback("host_status", undefined, fallbackHostStatus());
}

export async function installHost(): Promise<HostOperationResult> {
  return invokeOrFallback("host_install", undefined, {
    success: false,
    code: "unsupported",
    message: "Open FractalMind.app on macOS to install this host.",
  });
}

export async function restartHost(): Promise<HostOperationResult> {
  return invokeOrFallback("host_restart", undefined, {
    success: false,
    code: "unsupported",
    message: "Open FractalMind.app on macOS to restart this host.",
  });
}

export async function rollbackHost(): Promise<HostOperationResult> {
  return invokeOrFallback("host_rollback", undefined, {
    success: false,
    code: "unsupported",
    message: "Open FractalMind.app on macOS to roll back this host.",
  });
}

async function invokeOrFallback<T>(command: string, args: Record<string, unknown> | undefined, fallback: T): Promise<T> {
  try {
    return await invokeNative<T>(command, args);
  } catch {
    return fallback;
  }
}

async function invokeNative<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!("__TAURI_INTERNALS__" in window)) throw new Error("Tauri runtime is not available.");
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(command, args);
}
