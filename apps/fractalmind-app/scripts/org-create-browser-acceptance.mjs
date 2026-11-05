/**
 * Real visual acceptance for the organization-creation UI.
 *
 * Preconditions (all generated, loopback-only test state):
 *   1. start isolated Sui localnet on 29000/29123;
 *   2. publish an isolated package copy with product-deployment-localnet.ts;
 *   3. run org-create-localnet.ts with FM_ORG_CREATE_BROWSER_READY=1;
 *   4. start Vite on 127.0.0.1:4189 and Chrome headless with CDP on 9333.
 *
 * The small bridge exposes only generated `test-*` DeviceVault profiles to the
 * browser. Its signer still uses the production native helper; every accepted
 * write is an actual isolated-localnet transaction. No public endpoint,
 * keystore, user profile or secret export is ever accepted.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { requestSuiFromFaucetV2 } from "@mysten/sui/faucet";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { Ed25519PublicKey } from "@mysten/sui/keypairs/ed25519";
import { fromBase64, toBase64 } from "@mysten/sui/utils";
import {
  FractalMindSDK,
  MemoryTransactionJournal,
  randomContentKey,
  SelfPayTransactionManager,
  wrapKeys,
} from "@fractalmind-labs/fractalmind-sdk";

assert.ok(process.argv[2] && process.argv[3], "Pass the browser-ready fixture report and screenshot directory.");
const fixture = JSON.parse(await readFile(process.argv[2], "utf8"));
assert.equal(fixture.browserReady, true, "Use FM_ORG_CREATE_BROWSER_READY=1 to create the fixture.");
assert.match(fixture.profile, /^test-[A-Za-z0-9_-]{1,59}$/);
const output = resolve(process.argv[3]);
await mkdir(output, { recursive: true });
const screenshotNames = [
  "01-orgs-entry", "02-org-menu-entry", "03-root-form-name-taken",
  "04-fee-quote", "05-pending", "06-confirmed-workbench",
  "07-non-root-explanation",
];
const requestedScreenshots = process.env.FM_ORG_CREATE_SCREENSHOTS
  ? new Set(process.env.FM_ORG_CREATE_SCREENSHOTS.split(",").map((name) => name.trim()).filter(Boolean))
  : null;
if (requestedScreenshots)
  for (const name of requestedScreenshots)
    assert.ok(screenshotNames.includes(name), `Unknown screenshot set: ${name}`);
const rpc = fixture.connection?.rpcUrl;
assert.equal(fixture.connection?.network, "localnet");
assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(new URL(rpc).hostname), "Visual acceptance is localnet only.");
const helper = resolve("native/target/debug/examples/device-test-helper");
await access(helper);

const rootProfile = fixture.profile;
const scopedProfile = `test-org-scope-${randomBytes(4).toString("hex")}`;
// The protocol registry globally owns names. The first captured form uses the
// current Human's name and must block quotation; this fresh name is used for
// the real fee quote and transaction that follow.
const createdOrganizationName = `Browser-localnet-${randomBytes(4).toString("hex")}`;
const allowedProfiles = new Set([rootProfile]);
let scopedCreated = false;
let bridge;
let page;

function native(profile, action, extra = {}) {
  assert.ok(allowedProfiles.has(profile), "Only this run's generated profiles may use the visual bridge.");
  const result = spawnSync(helper, [], {
    input: JSON.stringify({ action, profile, ...extra }),
    encoding: "utf8",
    timeout: 30_000,
    maxBuffer: 1_500_000,
  });
  if (result.status !== 0)
    throw new Error(result.stderr.trim() || `Native ${action} failed.`);
  return JSON.parse(result.stdout);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function localStatus(profile) {
  native(profile, "public"); // also opens the isolated native test session
  return {
    profile,
    unlocked: true,
    idleTimeoutMs: 15 * 60_000,
    remainingMs: 15 * 60_000,
  };
}

async function bridgeValue(command, args) {
  const profile = args?.profile;
  switch (command) {
    case "fm_device_session":
    case "fm_device_touch":
      return localStatus(profile);
    case "fm_device_unlock":
    case "fm_device_public":
      return native(profile, "public");
    case "fm_device_sign_transaction": {
      const signed = native(profile, "signTransaction", { bytes: args.bytes });
      // Keep the genuine post-click signing state visible long enough for all
      // four screenshots. The signed bytes were already produced by the native
      // helper and will still be submitted once this intentional UI delay ends.
      await sleep(8_000);
      return signed;
    }
    case "fm_device_set_idle_timeout":
      return Number(args?.ms ?? 0);
    case "fm_device_lock":
    case "fm_app_appearance":
      return null;
    default:
      throw new Error(`Visual bridge does not expose ${command}.`);
  }
}

async function startBridge() {
  bridge = createServer(async (request, response) => {
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Access-Control-Allow-Headers", "content-type");
    if (request.method === "OPTIONS") return response.writeHead(204).end();
    if (request.method !== "POST" || request.url !== "/invoke") {
      response.writeHead(404).end();
      return;
    }
    let body = "";
    for await (const chunk of request) body += chunk;
    try {
      const value = JSON.parse(body);
      const result = await bridgeValue(value.command, value.args ?? {});
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ ok: true, result }));
    } catch (error) {
      response.writeHead(500, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    }
  });
  await new Promise((resolve) => bridge.listen(4188, "127.0.0.1", resolve));
}

class Cdp {
  constructor(url) {
    this.next = 1;
    this.pending = new Map();
    this.socket = new WebSocket(url);
  }
  async open() {
    await new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(typeof event.data === "string" ? event.data : String(event.data));
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      message.error ? pending.reject(new Error(message.error.message)) : pending.resolve(message.result);
    });
    return this;
  }
  send(method, params = {}) {
    const id = this.next++;
    this.socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  close() {
    this.socket.close();
  }
}

async function cdpPage() {
  const created = await fetch("http://127.0.0.1:9333/json/new?about:blank", { method: "PUT" });
  assert.ok(created.ok, "Chrome remote debugging on 127.0.0.1:9333 is required.");
  const target = await created.json();
  return new Cdp(target.webSocketDebuggerUrl).open();
}

async function evaluate(expression) {
  const result = await page.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails)
    throw new Error(result.exceptionDetails.text || "Page evaluation failed.");
  return result.result.value;
}

async function waitFor(expression, name, timeout = 25_000) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    try {
      if (await evaluate(expression)) return;
    } catch (error) {
      last = error;
    }
    await sleep(100);
  }
  const diagnostic = await evaluate(`JSON.stringify({
    rendered: (document.body?.innerText || '').slice(0, 1_000),
    isTauri: globalThis.isTauri,
    publicConnection: localStorage.getItem('fractalmind.app.public-connection.v1'),
    deviceConnection: localStorage.getItem('fractalmind.app.device-connection.v1'),
  })`).catch(() => "");
  throw last ?? new Error(`Timed out waiting for ${name}. Page diagnostics: ${diagnostic}`);
}

async function viewport(width, height, mobile) {
  await page.send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1,
    mobile,
  });
  await sleep(350);
}

async function setTheme(theme) {
  await viewport(1280, 800, false);
  for (let tries = 0; tries < 4; tries++) {
    if ((await evaluate("document.documentElement.dataset.theme")) === theme) return;
    const clicked = await evaluate(`(() => {
      const button = document.querySelector('.topbar button[aria-label="外观"]');
      if (!button) return false;
      button.click();
      return true;
    })()`);
    assert.equal(clicked, true, "Appearance control is available.");
    await sleep(100);
  }
  throw new Error(`Could not set ${theme} theme.`);
}

async function screenshot(name) {
  const image = await page.send("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: false,
  });
  await writeFile(join(output, `${name}.png`), Buffer.from(image.data, "base64"));
}

async function screenshotMatrix(name) {
  if (requestedScreenshots && !requestedScreenshots.has(name)) return;
  await setTheme("light");
  await viewport(1280, 800, false);
  await screenshot(`${name}-light-desktop-1280x800`);
  await viewport(390, 844, true);
  await screenshot(`${name}-light-phone-390x844`);
  await setTheme("dark");
  await viewport(1280, 800, false);
  await screenshot(`${name}-dark-desktop-1280x800`);
  await viewport(390, 844, true);
  await screenshot(`${name}-dark-phone-390x844`);
}

function clickExpression(text, includes = false) {
  return `(() => {
    const text = ${JSON.stringify(text)};
    const node = [...document.querySelectorAll('button, a')].find((candidate) => {
      const value = (candidate.innerText || candidate.textContent || '').trim();
      return ${includes ? "value.includes(text)" : "value === text"};
    });
    if (!node) return false;
    node.click();
    return true;
  })()`;
}

async function click(text, includes = false) {
  assert.equal(await evaluate(clickExpression(text, includes)), true, `Could not click ${text}.`);
  await sleep(150);
}

async function fill(id, value) {
  const updated = await evaluate(`(() => {
    const node = document.getElementById(${JSON.stringify(id)});
    if (!node) return false;
    const setter = Object.getOwnPropertyDescriptor(
      node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
      'value',
    ).set;
    setter.call(node, ${JSON.stringify(value)});
    node.dispatchEvent(new Event('input', { bubbles: true }));
    node.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  assert.equal(updated, true, `Could not fill #${id}.`);
  await sleep(100);
}

function bridgeBootstrap() {
  const connection = JSON.stringify(fixture.connection);
  const device = JSON.stringify({
    profile: rootProfile,
    humanId: fixture.humanId,
    network: fixture.connection.network,
    registryId: fixture.connection.registryId,
  });
  return `(() => {
    const profileKey = 'fractalmind.app.public-connection.v1';
    const deviceKey = 'fractalmind.app.device-connection.v1';
    // This is a dedicated, throwaway browser tab. Replace both public records
    // on a fresh tab so a prior localnet's chain identity cannot leak into
    // this run. A same-tab reload after the scoped-device transition preserves
    // its explicitly selected device profile.
    localStorage.setItem(profileKey, JSON.stringify(${connection}));
    if (sessionStorage.getItem('fm-org-create-visual-device') !== 'scoped')
      localStorage.setItem(deviceKey, JSON.stringify(${device}));
    Object.defineProperty(globalThis, 'isTauri', { value: true, configurable: true });
    globalThis.__TAURI_INTERNALS__ = {
      invoke: async (command, args = {}) => {
        const response = await fetch('http://127.0.0.1:4188/invoke', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ command, args }),
        });
        const body = await response.json();
        if (!response.ok || !body.ok) throw new Error(body.error || 'Native visual bridge failed.');
        return body.result;
      },
      transformCallback: () => 0,
      unregisterCallback: () => {},
      convertFileSrc: () => '',
    };
  })();`;
}

async function addScopedDevice() {
  // The helper owns the actual scoped private key. The SDK signer adapter is
  // only for the existing root device and forwards its signing bytes straight
  // to that native helper.
  const rootSigner = {
    getPublicKey: () => new Ed25519PublicKey(fromBase64(fixture.device.signingPublicKey)),
    async signTransaction(bytes) {
      return native(rootProfile, "signTransaction", { bytes: toBase64(new Uint8Array(bytes)) });
    },
  };
  allowedProfiles.add(scopedProfile);
  const scopedPublic = native(scopedProfile, "initialize");
  scopedCreated = true;
  const client = new SuiGrpcClient({ baseUrl: rpc, network: "localnet" });
  const sdk = new FractalMindSDK({
    packageId: fixture.connection.packageId,
    registryId: fixture.connection.registryId,
    client,
    network: "localnet",
  });
  await requestSuiFromFaucetV2({ host: "http://127.0.0.1:29123", recipient: scopedPublic.address });
  const contentKey = randomContentKey();
  try {
    const manager = new SelfPayTransactionManager({
      client,
      network: "localnet",
      signer: rootSigner,
      journal: new MemoryTransactionJournal(),
    });
    const quote = await manager.prepare({
      requestId: `visual-add-scoped:${rootProfile}`,
      gasBudget: 200_000_000n,
      transaction: sdk.identity.addReadDevice({
        identityRegistryId: await sdk.identity.resolveRegistry(),
        humanId: fixture.humanId,
        grantId: fixture.rootGrantId,
        organizationId: fixture.personalOrganizationId,
        device: scopedPublic.address,
        deviceEncryptionKey: fromBase64(scopedPublic.encryptionPublicKey),
        encryptedDeviceKeys: await wrapKeys(
          contentKey,
          fromBase64(scopedPublic.encryptionPublicKey),
          `fractalmind.device-keys.v1:localnet:${scopedPublic.address}`,
        ),
      }),
    });
    const result = await manager.submit(quote);
    assert.equal(result.status, "confirmed", "Scoped-device fixture must be confirmed.");
  } finally {
    contentKey.fill(0);
  }
  return scopedPublic;
}

try {
  await startBridge();
  page = await cdpPage();
  await page.send("Page.addScriptToEvaluateOnNewDocument", { source: bridgeBootstrap() });
  await page.send("Page.enable");
  await page.send("Page.navigate", { url: "http://127.0.0.1:4189/#/orgs" });
  await waitFor("document.body.innerText.includes('我的组织')", "loaded signed-in organization page");
  await screenshotMatrix("01-orgs-entry");

  await viewport(1280, 800, false);
  await setTheme("light");
  assert.equal(await evaluate(`(() => {
    const button = document.querySelector('button[aria-label="切换组织"]');
    if (!button) return false;
    button.click();
    return true;
  })()`), true, "Organization switcher control is available.");
  await waitFor("document.body.innerText.includes('新建组织…')", "organization switcher entry");
  await screenshotMatrix("02-org-menu-entry");
  await evaluate(`document.querySelector('button[aria-label="切换组织"]')?.click()`);
  await click("新建组织");
  await waitFor("!!document.getElementById('organization-name')", "root-device organization form");
  await fill("organization-name", fixture.personalOrganizationName);
  await fill("organization-description", "为实际本地网络验收创建的第二个组织。");
  await waitFor("document.body.innerText.includes('你已经有一个叫')", "occupied own-name warning");
  const occupiedNameState = await evaluate(`(() => {
    const field = document.getElementById("organization-name")?.closest(".field");
    return {
      error: field?.querySelector(".err-t")?.innerText || "",
      inputIsDanger: document.getElementById("organization-name")?.classList.contains("err") || false,
      hasAlwaysOnHint: field?.innerText.includes("建好后其他人在开放网络里也会看到它。") || false,
    };
  })()`);
  assert.equal(
    occupiedNameState.error,
    `你已经有一个叫「${fixture.personalOrganizationName}」的组织了。组织名称在整个网络里不能重复，换一个吧。`,
    "The own-name message quotes the name with Chinese quotation marks.",
  );
  assert.equal(occupiedNameState.inputIsDanger, true, "An occupied name uses the v2 danger field treatment.");
  assert.equal(occupiedNameState.hasAlwaysOnHint, false, "An occupied name shows its error without the generic uniqueness hint.");
  assert.equal(await evaluate(`(() => [...document.querySelectorAll('button')]
    .find((button) => (button.innerText || '').trim() === '签名创建')?.disabled)()`), true,
    "An occupied global name must not quote or submit.");
  await screenshotMatrix("03-root-form-name-taken");

  // The occupied name did not allocate a request, quote, signature or
  // transaction. Change it to a fresh global name for the real flow.
  await viewport(1280, 800, false);
  await setTheme("light");
  await fill("organization-name", createdOrganizationName);
  await sleep(550);
  await waitFor("!document.body.innerText.includes('你已经有一个叫')", "unique organization name");
  await viewport(1280, 800, false);
  await setTheme("light");
  await click("签名创建");
  await waitFor("document.body.innerText.includes('预计手续费') && document.body.innerText.includes('签名创建 · 预计')", "self-pay fee quote");
  await screenshotMatrix("04-fee-quote");

  await viewport(1280, 800, false);
  await setTheme("light");
  await click("签名创建 · 预计", true);
  await waitFor("document.body.innerText.includes('签名创建中')", "pending signing state");
  await screenshotMatrix("05-pending");
  await waitFor("document.body.innerText.includes('组织已建好')", "confirmed organization success");
  await screenshotMatrix("06-confirmed-workbench");

  const scopedPublic = await addScopedDevice();
  await evaluate(`(() => {
    sessionStorage.setItem('fm-org-create-visual-device', 'scoped');
    localStorage.setItem('fractalmind.app.device-connection.v1', JSON.stringify(${JSON.stringify({
      profile: scopedProfile,
      humanId: fixture.humanId,
      network: fixture.connection.network,
      registryId: fixture.connection.registryId,
    })}));
    location.hash = '#/orgs';
    location.reload();
  })()`);
  await waitFor("document.body.innerText.includes('我的组织')", "scoped-device organization page");
  await viewport(1280, 800, false);
  await setTheme("light");
  await click("新建组织");
  await waitFor("document.body.innerText.includes('只有主设备能新建组织')", "non-root explanation");
  await waitFor(`document.body.innerText.includes(${JSON.stringify(`另一台设备 ·`)})`, "unnamed-device label");
  await screenshotMatrix("07-non-root-explanation");

  const files = screenshotNames.flatMap((name) => [
      `${name}-light-desktop-1280x800.png`, `${name}-light-phone-390x844.png`,
      `${name}-dark-desktop-1280x800.png`, `${name}-dark-phone-390x844.png`,
    ]);
  if (!requestedScreenshots)
    await writeFile(join(output, "acceptance.json"), JSON.stringify({
      format: 1,
      recordedAt: new Date().toISOString(),
      network: "localnet",
      browser: "Chrome headless through CDP",
      viewportSets: ["1280x800", "390x844"],
      themes: ["light", "dark"],
      screenshots: files,
      privateKeysInReport: false,
    }, null, 2) + "\n");
  console.log(JSON.stringify({
    passed: requestedScreenshots ? requestedScreenshots.size * 4 : files.length,
    output,
    refreshed: requestedScreenshots ? [...requestedScreenshots] : undefined,
  }));
} finally {
  try { await page?.send("Page.close"); } catch {}
  page?.close();
  if (bridge) await new Promise((resolve) => bridge.close(resolve));
  if (scopedCreated) {
    try { native(scopedProfile, "remove"); } catch {}
  }
  try { native(rootProfile, "remove"); } catch {}
}
