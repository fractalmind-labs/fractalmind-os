import assert from "node:assert/strict";
import { hkdfSync, randomUUID, timingSafeEqual } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { Transaction } from "@mysten/sui/transactions";
import { fromBase64, toBase64 } from "@mysten/sui/utils";
import {
  parseRecoveryCode,
  unwrapKeys,
} from "@fractalmind-labs/fractalmind-sdk";
import { NativeDeviceSigner, type NativeInvoke } from "../src/native-device";
import { NativeRecoverySigner } from "../src/native-onboarding";

// Only an explicitly named disposable emulator is supported. The real debug
// WebView invokes the installed App's production commands and Android store.
// This fixture signs offline bytes; it never broadcasts or grants authority.
const options = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i],
    value = process.argv[i + 1];
  if (!key?.startsWith("--") || !value || options.has(key))
    throw new Error("Invalid arguments");
  options.set(key, value);
}
const allowed = [
  "--adb",
  "--adb-port",
  "--serial",
  "--avd",
  "--devtools-port",
  "--report",
];
if ([...options.keys()].some((key) => !allowed.includes(key)))
  throw new Error("Unknown argument");
function required(key: string) {
  const value = options.get(key);
  if (!value) throw new Error(`Missing ${key}`);
  return value;
}
const adbPath = required("--adb"),
  serial = required("--serial"),
  avd = required("--avd");
const adbPort = Number(required("--adb-port")),
  port = Number(required("--devtools-port"));
const reportPath = required("--report");
const app = "org.fractalmind.desktop";
assert.match(serial, /^emulator-[0-9]+$/);
assert.match(avd, /^fm-v020-android-[a-z0-9_-]+$/);
for (const value of [adbPort, port])
  assert.ok(Number.isInteger(value) && value > 1024 && value < 65536);
assert.ok(
  !existsSync(reportPath) && !existsSync(reportPath + ".progress.json"),
  "Prior reports cannot be overwritten",
);
function adb(...args: string[]) {
  return execFileSync(adbPath, ["-P", String(adbPort), "-s", serial, ...args], {
    encoding: "utf8",
    timeout: 20_000,
  });
}
assert.equal(adb("emu", "avd", "name").split("\n")[0]?.trim(), avd);
assert.equal(adb("shell", "getprop", "sys.boot_completed").trim(), "1");
assert.match(adb("shell", "pm", "path", app), /^package:/);
assert.match(adb("shell", "dumpsys", "package", app), /versionName=0\.2\.0/);
function nativeSystemBars() {
  const block = adb("shell", "dumpsys", "window", "windows")
    .split(/(?=  Window #)/)
    .find(
      (value) =>
        value.includes(`${app}/${app}.MainActivity`) &&
        value.includes("mAttrs="),
    );
  assert.ok(block, "Actual installed Activity window is required");
  return {
    lightStatus: block.includes("LIGHT_STATUS_BARS"),
    lightNavigation: block.includes("LIGHT_NAVIGATION_BARS"),
  };
}
async function expectSystemBars(light: boolean) {
  // Only OS observation is polled; no native mutation is retried.
  for (let attempt = 0; attempt < 20; attempt++) {
    const bars = nativeSystemBars();
    if (bars.lightStatus === light && bars.lightNavigation === light)
      return bars;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.fail("Actual system bars must follow the App theme");
}

class Devtools {
  private sequence = 0;
  private pending = new Map<
    number,
    {
      resolve: (value: any) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private constructor(private socket: WebSocket) {
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      const waiter = this.pending.get(message.id);
      if (!waiter) return;
      this.pending.delete(message.id);
      clearTimeout(waiter.timer);
      if (message.error) waiter.reject(new Error("DevTools command failed"));
      else waiter.resolve(message.result);
    });
    socket.addEventListener("close", () => {
      for (const waiter of this.pending.values()) {
        clearTimeout(waiter.timer);
        waiter.reject(new Error("Original WebView closed"));
      }
      this.pending.clear();
    });
  }
  static async connect() {
    const pid = adb("shell", "pidof", app).trim();
    assert.match(pid, /^[0-9]+$/);
    const sockets = adb("shell", "cat", "/proc/net/unix");
    assert.ok(
      sockets.includes(`@webview_devtools_remote_${pid}`),
      "Actual debug WebView is required",
    );
    adb(
      "forward",
      `tcp:${port}`,
      `localabstract:webview_devtools_remote_${pid}`,
    );
    const targets = (await (
      await fetch(`http://127.0.0.1:${port}/json/list`)
    ).json()) as Array<{
      type: string;
      url: string;
      webSocketDebuggerUrl: string;
    }>;
    const target = targets.find(
      (item) => item.type === "page" && item.url === "http://tauri.localhost/",
    );
    assert.ok(target, "Bundled App origin is required");
    assert.ok(
      target.webSocketDebuggerUrl.startsWith(`ws://127.0.0.1:${port}/`),
    );
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("WebView connection timed out")),
        15_000,
      );
      socket.addEventListener(
        "open",
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
      socket.addEventListener(
        "error",
        () => {
          clearTimeout(timer);
          reject(new Error("WebView connection failed"));
        },
        { once: true },
      );
    });
    const cdp = new Devtools(socket);
    try {
      let ready = false;
      for (let attempt = 0; attempt < 50; attempt++) {
        ready = await cdp.evaluate<boolean>(
          `document.readyState==='complete' && document.querySelectorAll('button.welcome-option').length===3 && typeof window.__TAURI_INTERNALS__?.invoke==='function'`,
        );
        if (ready) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      assert.ok(
        ready,
        "Actual welcome UI must finish loading before native calls",
      );
      return { cdp, pid };
    } catch (error) {
      cdp.close();
      throw error;
    }
  }
  async evaluate<T>(expression: string): Promise<T> {
    const id = ++this.sequence;
    const response = await new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("Original native request timed out; not retried"));
      }, 30_000);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(
        JSON.stringify({
          id,
          method: "Runtime.evaluate",
          params: { expression, awaitPromise: true, returnByValue: true },
        }),
      );
    });
    if (response.exceptionDetails) throw new Error("WebView evaluation failed");
    return response.result.value as T;
  }
  close() {
    this.socket.close();
  }
}

const checks: string[] = [];
const report: Record<string, unknown> = {
  format: 1,
  scope:
    "Installed ARM64 Android App native IPC and credential persistence; offline signatures only",
  app,
  avd,
  serial,
  broadcasts: 0,
  checks,
};
function checkpoint(name: string) {
  checks.push(name);
  writeFileSync(
    reportPath + ".progress.json",
    JSON.stringify(report, null, 2) + "\n",
  );
}
let active: Devtools | undefined;
let recoveryEncryptionSecret: Uint8Array | undefined;
let originalBackup: Uint8Array | undefined;
async function sameOnboarding(
  original: NativeRecoverySigner,
  reloaded: NativeRecoverySigner,
) {
  assert.deepEqual(reloaded.material.device, original.material.device);
  assert.deepEqual(reloaded.material.recovery, original.material.recovery);
  assert.equal(reloaded.material.network, original.material.network);
  assert.ok(recoveryEncryptionSecret && originalBackup);
  const plaintext = await unwrapKeys(
    fromBase64(reloaded.material.encryptedBackup),
    recoveryEncryptionSecret,
    `fractalmind.recovery-backup.v1:localnet:${original.material.recovery.address}`,
  );
  try {
    assert.ok(
      plaintext.length === originalBackup.length &&
        timingSafeEqual(plaintext, originalBackup),
      "Original wrapped content keyring must survive reload",
    );
  } finally {
    plaintext.fill(0);
  }
}
async function transaction(sender: string) {
  const tx = new Transaction();
  tx.setSender(sender);
  tx.setGasPrice(1);
  tx.setGasBudget(1_000_000);
  tx.setGasPayment([
    {
      objectId: "0x1",
      version: "1",
      digest: "11111111111111111111111111111111",
    },
  ]);
  tx.transferObjects([tx.gas], tx.pure.address(sender));
  return tx.build();
}
async function nativeRequest(
  command: Parameters<NativeInvoke>[0] | "fm_app_appearance",
  args: Record<string, string>,
) {
  assert.ok(active);
  // No request/response tracing: the one-shot backup credential stays in memory.
  const result = await active.evaluate<{
    ok: boolean;
    value?: unknown;
    error?: string;
  }>(
    `(async()=>{try{return {ok:true,value:await window.__TAURI_INTERNALS__.invoke(${JSON.stringify(command)},${JSON.stringify(args)})}}catch(e){return {ok:false,error:String(e)}}})()`,
  );
  if (!result.ok) throw result.error;
  return result.value;
}
const invoke: NativeInvoke = nativeRequest;
async function rejected(
  command: Parameters<NativeInvoke>[0] | "fm_app_appearance",
  args: Record<string, string>,
  expected: string,
) {
  await assert.rejects(
    async () => nativeRequest(command, args),
    (error) => error === expected,
  );
}

try {
  const initial = await Devtools.connect();
  active = initial.cdp;
  report.initialPid = initial.pid;
  const page = await active.evaluate<Record<string, unknown>>(
    `({origin:location.origin,secure:isSecureContext,native:typeof window.__TAURI_INTERNALS__?.invoke==='function',width:innerWidth,scrollWidth:document.documentElement.scrollWidth,text:document.body.innerText,storageKeys:Object.keys(localStorage)})`,
  );
  assert.equal(page.origin, "http://tauri.localhost");
  assert.equal(page.native, true);
  assert.equal(page.secure, true);
  assert.ok(
    Number(page.width) <= 600 &&
      Number(page.scrollWidth) <= Number(page.width) + 1,
  );
  assert.match(String(page.text), /创建我的身份|Create my identity/);
  assert.match(String(page.text), /使用恢复码找回|Recover with a code/);
  report.initialPage = page;
  checkpoint("Bundled native welcome, secure context and mobile viewport");
  const profile = `test-android-${randomUUID().slice(0, 12)}`;
  const onboardingProfile = `${profile}-onboarding`;
  report.profiles = [profile, onboardingProfile];
  await rejected("fm_device_public", { profile }, "NotInitialized");
  checkpoint("Missing credential fails without initialization");
  const signer = await NativeDeviceSigner.initialize(invoke, profile);
  report.device = signer.device;
  assert.deepEqual(
    (await NativeDeviceSigner.initialize(invoke, profile)).device,
    signer.device,
  );
  checkpoint(
    "Android credential generation, verified public keys and idempotent initialization",
  );
  await rejected(
    "fm_device_initialize",
    { profile: "../invalid" },
    "InvalidProfile",
  );
  checkpoint("Native profile boundary");
  const proofInput = {
    chainIdentifier: "offlineAndroidAcceptance",
    humanId: "0x" + "1".repeat(64),
    grantId: "0x" + "2".repeat(64),
    nonce: randomUUID().replaceAll("-", ""),
    expiresAtMs: Date.now() + 60_000,
  };
  await signer.proveDevice(proofInput);
  checkpoint(
    "Native bounded possession signature verified by production client",
  );
  await signer.signTransaction(await transaction(signer.device.address));
  checkpoint("Native programmable transaction signature verified offline");
  await rejected(
    "fm_device_sign_transaction",
    { profile, bytes: toBase64(await transaction("0x" + "3".repeat(64))) },
    "WrongSender",
  );
  checkpoint("Wrong transaction sender rejected natively");
  await rejected(
    "fm_device_sign_node_command",
    {
      profile,
      bytes: toBase64(new TextEncoder().encode("arbitrary raw signing")),
    },
    "InvalidNodeCommand",
  );
  checkpoint("Arbitrary command bytes rejected natively");
  const created = await NativeRecoverySigner.create(
    invoke,
    onboardingProfile,
    "localnet",
  );
  // The production signer already parses and validates the versioned code.
  // Never retain it in a report or infer a punctuation format here.
  assert.ok(created.recoveryCode.length > 0);
  const parsed = parseRecoveryCode(created.recoveryCode);
  try {
    recoveryEncryptionSecret = new Uint8Array(
      hkdfSync(
        "sha256",
        parsed.entropy,
        new TextEncoder().encode("fractalmind.recovery.v1"),
        new TextEncoder().encode("encryption"),
        32,
      ),
    );
  } finally {
    parsed.entropy.fill(0);
    created.recoveryCode = "";
  }
  originalBackup = await unwrapKeys(
    fromBase64(created.signer.material.encryptedBackup),
    recoveryEncryptionSecret,
    `fractalmind.recovery-backup.v1:localnet:${created.signer.material.recovery.address}`,
  );
  report.onboarding = created.signer.material;
  checkpoint(
    "Independent device/recovery credentials and wrapped onboarding material",
  );
  await sameOnboarding(
    created.signer,
    await NativeRecoverySigner.load(invoke, onboardingProfile, "localnet"),
  );
  await rejected(
    "fm_onboarding_create",
    { profile: onboardingProfile, network: "localnet" },
    "AlreadyInitialized",
  );
  checkpoint("Read-only onboarding reload and duplicate creation rejection");
  await created.signer.signTransaction(
    await transaction(created.signer.material.recovery.address),
  );
  checkpoint("Native recovery transaction signature verified offline");
  await rejected(
    "fm_app_appearance",
    { theme: "arbitrary" },
    "InvalidAppearance",
  );
  checkpoint("Native appearance rejects values outside light/dark");
  await active.evaluate(
    `(()=>{const s=document.querySelector('select[aria-label="语言"],select[aria-label="Language"]');s.value='zh';s.dispatchEvent(new Event('change',{bubbles:true}));return true})()`,
  );
  await active.evaluate(
    `(()=>{const s=document.querySelector('select[aria-label="外观"],select[aria-label="Appearance"]');s.value='light';s.dispatchEvent(new Event('change',{bubbles:true}));return true})()`,
  );
  assert.deepEqual(
    await active.evaluate(
      `({lang:document.documentElement.lang,theme:document.documentElement.dataset.theme})`,
    ),
    { lang: "zh-CN", theme: "light" },
  );
  report.nativeBarsLight = await expectSystemBars(true);
  checkpoint("Actual light App controls set dark system-bar icons");
  await active.evaluate(
    `(()=>{const s=document.querySelector('select[aria-label="语言"]');s.value='en';s.dispatchEvent(new Event('change',{bubbles:true}));return true})()`,
  );
  await active.evaluate(
    `(()=>{const s=document.querySelector('select[aria-label="Appearance"]');s.value='dark';s.dispatchEvent(new Event('change',{bubbles:true}));return true})()`,
  );
  const appearance = await active.evaluate<{ lang: string; theme: string }>(
    `({lang:document.documentElement.lang,theme:document.documentElement.dataset.theme})`,
  );
  assert.deepEqual(appearance, { lang: "en", theme: "dark" });
  report.nativeBarsDark = await expectSystemBars(false);
  checkpoint("Actual dark App controls set light system-bar icons");
  checkpoint("Actual native welcome language and dark theme controls");
  const storedAppearance = await active.evaluate<{
    language: string;
    theme: string;
  }>(`JSON.parse(localStorage.getItem('fractalmind.app.appearance.v1'))`);
  assert.deepEqual(storedAppearance, { language: "en", theme: "dark" });
  report.appearanceBeforeRestart = storedAppearance;
  // Public preference storage has a browser commit queue. Exercise the normal
  // background-then-cold-start journey, and record the delay explicitly.
  adb("shell", "input", "keyevent", "KEYCODE_HOME");
  await new Promise((resolve) => setTimeout(resolve, 6_000));
  report.backgroundBeforeStopMs = 6_000;
  active.close();
  active = undefined;
  adb("shell", "am", "force-stop", app);
  const stopped = spawnSync(
    adbPath,
    ["-P", String(adbPort), "-s", serial, "shell", "pidof", app],
    { encoding: "utf8", timeout: 20_000 },
  );
  assert.equal(stopped.status, 1);
  assert.equal(stopped.stdout.trim(), "");
  adb("shell", "am", "start", "-W", "-n", `${app}/.MainActivity`);
  // Only discovery is retried. Native creation/signing requests are never replayed.
  let restarted: Awaited<ReturnType<typeof Devtools.connect>> | undefined;
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      restarted = await Devtools.connect();
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  assert.ok(restarted);
  active = restarted.cdp;
  report.restartedPid = restarted.pid;
  assert.notEqual(restarted.pid, initial.pid);
  assert.deepEqual(
    (await NativeDeviceSigner.load(invoke, profile)).device,
    signer.device,
  );
  await sameOnboarding(
    created.signer,
    await NativeRecoverySigner.load(invoke, onboardingProfile, "localnet"),
  );
  checkpoint(
    "Cold App process restart preserves original device and recovery keys",
  );
  await (
    await NativeDeviceSigner.load(invoke, profile)
  ).proveDevice({
    ...proofInput,
    nonce: randomUUID().replaceAll("-", ""),
    expiresAtMs: Date.now() + 60_000,
  });
  checkpoint("Reloaded Android credential signs a new bounded challenge");
  const restoredAppearance = await active.evaluate<{
    lang: string;
    theme: string;
  }>(
    `({lang:document.documentElement.lang,theme:document.documentElement.dataset.theme})`,
  );
  assert.deepEqual(restoredAppearance, appearance);
  checkpoint("Public language/appearance preferences survive process restart");
  report.nativeBarsRestart = await expectSystemBars(false);
  checkpoint("Cold-start system bars follow the original App appearance");
  report.completed = true;
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
  console.log(
    `Android native acceptance passed: ${checks.length} checks, 0 broadcasts. Report: ${reportPath}`,
  );
} catch (error) {
  report.completed = false;
  report.failure = error instanceof Error ? error.message : String(error);
  writeFileSync(
    reportPath + ".progress.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  throw error;
} finally {
  recoveryEncryptionSecret?.fill(0);
  originalBackup?.fill(0);
  active?.close();
  adb("forward", "--remove", `tcp:${port}`);
}
