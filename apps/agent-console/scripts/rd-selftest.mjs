// Hermetic self-test of the RemoteDesktop input layer: serve the built app,
// mock RTCPeerConnection + coordinator fetch so the viewer opens without a real
// peer, then drive real pointer/keyboard events and capture what the input data
// channel actually sends. Evidence for: on-screen keys firing, backspace,
// Enter, typing, and modifier combos.
import { chromium } from "playwright";
import { createServer } from "http";
import { readFileSync, existsSync } from "fs";
import { extname, join } from "path";

const DIST = process.argv[2];
const PORT = 8199;

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
const server = createServer((req, res) => {
  let p = req.url.split("?")[0];
  if (p === "/" || !existsSync(join(DIST, p))) p = "/index.html";
  const f = join(DIST, p);
  if (!existsSync(f)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "content-type": MIME[extname(f)] || "text/plain" });
  res.end(readFileSync(f));
});
await new Promise((r) => server.listen(PORT, r));

const init = () => {
  window.__sent = [];
  const okDC = {
    readyState: "open",
    send: (m) => window.__sent.push(m),
    close() {},
    set onopen(fn) { setTimeout(() => fn && fn(), 0); },
  };
  class MockPC {
    addTransceiver() {}
    createDataChannel() { return okDC; }
    async createOffer() { return { type: "offer", sdp: "" }; }
    async setLocalDescription() {}
    async setRemoteDescription() {}
    addEventListener() {}
    removeEventListener() {}
    get iceGatheringState() { return "complete"; }
    get localDescription() { return { type: "offer", sdp: "" }; }
    set ontrack(_) {}
    set oniceconnectionstatechange(_) {}
    close() {}
  }
  window.RTCPeerConnection = MockPC;
  const realFetch = window.fetch;
  window.fetch = async (url, opt) => {
    const u = String(url);
    if (u.includes("/api/sentinels/") && u.includes("/desktop/ice"))
      return new Response(JSON.stringify({ iceServers: [] }), { status: 200 });
    if (u.includes("/desktop/offer"))
      return new Response(JSON.stringify({ answer: { type: "answer", sdp: "" } }), { status: 200 });
    if (u.endsWith("/api/sentinels"))
      return new Response(JSON.stringify({ count: 1, sentinels: [
        { id: "testnode", host_id: "", hostname: "testnode", version: "dev",
          connected_at: new Date().toISOString(), last_heartbeat: new Date().toISOString(),
          agent_count: 0, uptime_seconds: 10, system: { os: "linux", arch: "amd64" } }] }),
        { status: 200 });
    return realFetch(url, opt);
  };
};

const browser = await chromium.launch();
const page = await browser.newPage();
await page.addInitScript(init);
const results = {};
try {
  await page.goto(`http://localhost:${PORT}/`);
  // Connect form
  await page.fill('input[placeholder*="host"]', "http://x/coord");
  await page.fill('input[type="password"]', "tok");
  await page.click('button[type="submit"]');
  await page.waitForSelector(".card", { timeout: 5000 });
  results.nodeListed = true;
  // Open desktop viewer
  await page.click('button:has-text("Desktop")');
  await page.waitForSelector(".rd-keys", { timeout: 5000 });
  results.viewerOpened = true;
  await page.waitForTimeout(100); // let mock dc open

  const sentAfter = async (fn) => {
    await page.evaluate(() => (window.__sent = []));
    await fn();
    await page.waitForTimeout(50);
    return page.evaluate(() => window.__sent.map((m) => JSON.parse(m)));
  };
  // Tap an on-screen key button by its exact label (robust to emoji chars):
  // dispatch a real pointerdown, which is how the handler is wired.
  const tapKey = (label) =>
    page.evaluate((lbl) => {
      const btn = [...document.querySelectorAll(".rd-keys button")].find(
        (b) => b.textContent.trim() === lbl,
      );
      if (!btn) throw new Error("no button " + lbl);
      btn.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true }));
    }, label);

  results.backspaceBtn = await sentAfter(() => tapKey("⌫"));
  results.enterBtn = await sentAfter(() => tapKey("Enter"));
  results.escBtn = await sentAfter(() => tapKey("Esc"));
  // Combo: arm ctrl (on-screen) then type c in hidden field
  results.comboCtrlC = await sentAfter(async () => {
    await tapKey("ctrl");
    await page.locator(".rd-kbd").focus();
    await page.keyboard.press("c");
  });
  results.typing0 = 1;
  // Typing text
  results.typing = await sentAfter(async () => {
    await page.locator(".rd-kbd").focus();
    await page.keyboard.type("ab");
  });
} catch (e) {
  results.error = String(e);
}
console.log(JSON.stringify(results, null, 2));
await browser.close();
server.close();
