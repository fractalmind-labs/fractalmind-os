// Focused test: simulate an ICE failure and verify the viewer auto-reconnects
// (issues a second /desktop/offer) and shows the reconnecting UI.
import { chromium } from "playwright";
import { createServer } from "http";
import { readFileSync, existsSync } from "fs";
import { extname, join } from "path";

const DIST = process.argv[2];
const PORT = 8201;
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
const server = createServer((req, res) => {
  let p = req.url.split("?")[0];
  if (p === "/" || !existsSync(join(DIST, p))) p = "/index.html";
  const f = join(DIST, p);
  res.writeHead(existsSync(f) ? 200 : 404, { "content-type": MIME[extname(f)] || "text/plain" });
  res.end(existsSync(f) ? readFileSync(f) : "");
});
await new Promise((r) => server.listen(PORT, r));

const init = () => {
  window.__offers = 0;
  window.__pcs = [];
  class MockPC {
    constructor() { window.__pcs.push(this); this.iceConnectionState = "new"; this.oniceconnectionstatechange = null; }
    addTransceiver() {}
    createDataChannel() { return { readyState: "open", send() {}, close() {}, set onopen(fn) { setTimeout(() => fn && fn(), 0); } }; }
    async createOffer() { return { type: "offer", sdp: "" }; }
    async setLocalDescription() {}
    async setRemoteDescription() {}
    addEventListener() {}
    removeEventListener() {}
    get iceGatheringState() { return "complete"; }
    get localDescription() { return { type: "offer", sdp: "" }; }
    set ontrack(_) {}
    close() {}
    // test helper: drive an ICE state
    __setIce(s) { this.iceConnectionState = s; this.oniceconnectionstatechange && this.oniceconnectionstatechange(); }
  }
  window.RTCPeerConnection = MockPC;
  const realFetch = window.fetch;
  window.fetch = async (url, opt) => {
    const u = String(url);
    if (u.includes("/desktop/ice")) return new Response(JSON.stringify({ iceServers: [] }), { status: 200 });
    if (u.includes("/desktop/offer")) { window.__offers++; return new Response(JSON.stringify({ answer: { type: "answer", sdp: "" } }), { status: 200 }); }
    if (u.endsWith("/api/sentinels")) return new Response(JSON.stringify({ count: 1, sentinels: [{ id: "testnode", host_id: "", hostname: "testnode", version: "dev", connected_at: new Date().toISOString(), last_heartbeat: new Date().toISOString(), agent_count: 0, uptime_seconds: 10, system: { os: "linux", arch: "amd64" } }] }), { status: 200 });
    return realFetch(url, opt);
  };
};

const browser = await chromium.launch();
const page = await browser.newPage();
await page.addInitScript(init);
const out = {};
try {
  await page.goto(`http://localhost:${PORT}/`);
  await page.fill('input[placeholder*="host"]', "http://x/coord");
  await page.fill('input[type="password"]', "tok");
  await page.click('button[type="submit"]');
  await page.waitForSelector(".card", { timeout: 5000 });
  await page.click('button:has-text("Desktop")');
  await page.waitForSelector(".rd-keys", { timeout: 5000 });
  await page.waitForTimeout(200);
  out.offersAfterConnect = await page.evaluate(() => window.__offers);
  // Fire an ICE failure on the active pc.
  await page.evaluate(() => window.__pcs[window.__pcs.length - 1].__setIce("failed"));
  // Reconnecting UI should appear.
  out.reconnectUI = await page.locator('.rd-status', { hasText: "reconnecting" }).count().catch(() => 0);
  await page.waitForTimeout(1600); // first backoff is ~1000ms
  out.offersAfterFailure = await page.evaluate(() => window.__offers);
  out.reconnected = out.offersAfterFailure > out.offersAfterConnect;
} catch (e) {
  out.error = String(e);
}
console.log(JSON.stringify(out, null, 2));
await browser.close();
server.close();
