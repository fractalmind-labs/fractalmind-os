import { describe, expect, it } from "vitest";
import {
  ACCESSIBILITY_SETTINGS_URL,
  SCREEN_RECORDING_SETTINGS_URL,
  checkLabel,
  fallbackHostStatus,
  fallbackPermissions,
  helperInstallAvailable,
  hostVerified,
} from "./host";

describe("host status helpers", () => {
  it("keeps the canonical FractalMind app identity in browser fallback state", () => {
    const status = fallbackHostStatus();
    expect(status.productName).toBe("FractalMind");
    expect(status.bundleId).toBe("ai.fractalmind.app");
    expect(status.paths.appInstallPath).toBe("/Applications/FractalMind.app");
    expect(status.launchAgentLabel).toBe("ai.fractalmind.host");
  });

  it("exposes exact macOS privacy deep links", () => {
    const permissions = fallbackPermissions();
    expect(permissions.screenRecording.settingsUrl).toBe(SCREEN_RECORDING_SETTINGS_URL);
    expect(permissions.accessibility.settingsUrl).toBe(ACCESSIBILITY_SETTINGS_URL);
  });

  it("does not offer install without a verified helper source", () => {
    const status = fallbackHostStatus();
    expect(helperInstallAvailable(status)).toBe(false);
    expect(hostVerified(status, fallbackPermissions())).toBe(false);
  });

  it("offers install only when the native helper source check passes", () => {
    const status = fallbackHostStatus();
    status.helperSource = { state: "pass", message: "verified bundled helper" };

    expect(helperInstallAvailable(status)).toBe(true);
  });

  it("maps status states to compact readback labels", () => {
    expect(checkLabel("pass")).toBe("PASS");
    expect(checkLabel("fail")).toBe("FAIL");
    expect(checkLabel("unknown")).toBe("UNKNOWN");
    expect(checkLabel("unsupported")).toBe("N/A");
  });

  it("requires TCC and authentication before the host is called verified", () => {
    const status = fallbackHostStatus();
    status.helperInstalled = { state: "pass", message: "ok" };
    status.workerRunning = { state: "pass", message: "ok" };
    status.workerAuthenticated = { state: "unknown", message: "not proven" };
    status.desktopHealth = { state: "pass", message: "ok" };
    status.orphanFfmpeg = { state: "pass", message: "ok" };
    const permissions = fallbackPermissions();
    permissions.screenRecording = { ...permissions.screenRecording, state: "pass" };
    permissions.accessibility = { ...permissions.accessibility, state: "pass" };

    expect(hostVerified(status, permissions)).toBe(false);

    status.workerAuthenticated = { state: "pass", message: "ok" };
    expect(hostVerified(status, permissions)).toBe(true);
  });
});
