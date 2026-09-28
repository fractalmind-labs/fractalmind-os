import { chromium } from "playwright";
import { createServer } from "http";
import { readFileSync, existsSync } from "fs";
import { extname, join } from "path";

const DIST = process.argv[2];
const PORT = 8202;
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
  window.__offers = [];
  class MockPC {
    constructor() {
      this.iceConnectionState = "new";
      this.oniceconnectionstatechange = null;
      setTimeout(() => {
        this.iceConnectionState = "connected";
        this.oniceconnectionstatechange?.();
      }, 100);
    }
    addTransceiver() {}
    createDataChannel() {
      return { readyState: "open", send() {}, close() {}, set onopen(fn) { setTimeout(() => fn?.(), 0); } };
    }
    async createOffer() { return { type: "offer", sdp: "" }; }
    async setLocalDescription() {}
    async setRemoteDescription() {}
    async getStats() {
      return new Map([
        ["inbound", { type: "inbound-rtp", kind: "video", bytesReceived: 0, framesDecoded: 0, packetsLost: 0, packetsReceived: 0 }],
      ]);
    }
    addEventListener() {}
    removeEventListener() {}
    get iceGatheringState() { return "complete"; }
    get localDescription() { return { type: "offer", sdp: "" }; }
    set ontrack(_) {}
    close() {}
  }
  window.RTCPeerConnection = MockPC;
  const realFetch = window.fetch;
  window.fetch = async (url, opt) => {
    const u = String(url);
    if (u.includes("/desktop/ice")) return new Response(JSON.stringify({ iceServers: [] }), { status: 200 });
    if (u.includes("/desktop/status")) {
      return new Response(JSON.stringify({
        ok: true,
        turn_enabled: true,
        ice_servers: 2,
        session: { active: true, ice_state: "connected", streaming: false, frames_sent: 0, bytes_sent: 0, capture_width: 1920, capture_height: 1080, encode_height: 1080, fps: 30 },
      }), { status: 200 });
    }
    if (u.includes("/desktop/offer")) {
      window.__offers.push(JSON.parse(opt?.body || "{}"));
      return new Response(JSON.stringify({ answer: { type: "answer", sdp: "" } }), { status: 200 });
    }
    if (u.endsWith("/api/sentinels")) {
      return new Response(JSON.stringify({ count: 1, sentinels: [{ id: "testnode", host_id: "", hostname: "testnode", version: "dev", connected_at: new Date().toISOString(), last_heartbeat: new Date().toISOString(), agent_count: 0, uptime_seconds: 10, system: { os: "darwin", arch: "arm64" } }] }), { status: 200 });
    }
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
  await page.waitForSelector(".rd-warning", { timeout: 9000 });
  out.warning = await page.locator(".rd-warning").innerText();
  out.status = await page.locator(".rd-status").innerText();
} catch (e) {
  out.error = String(e);
}
console.log(JSON.stringify(out, null, 2));
await browser.close();
server.close();

const ok =
  !out.error &&
  out.status.includes("connected") &&
  out.warning.includes("no desktop frames") &&
  out.warning.includes("TURN is enabled");
process.exit(ok ? 0 : 1);
