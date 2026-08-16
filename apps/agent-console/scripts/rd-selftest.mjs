// Hermetic self-test of the RemoteDesktop input layer: serve the built app,
// mock RTCPeerConnection + coordinator fetch so the viewer opens without a real
// peer, then drive real pointer/keyboard events and capture what the input data
// channel actually sends. Evidence for: on-screen keys firing, backspace,
// Enter, typing, modifier combos, atomic mouse click semantics, duplicate
// suppression, touch gestures, and pointer/zoom coordinate accuracy.
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
  window.__offers = [];
  window.__contextMenus = [];
  window.addEventListener("contextmenu", (event) => {
    window.__contextMenus.push({ defaultPrevented: event.defaultPrevented });
  });
  Object.defineProperty(HTMLVideoElement.prototype, "videoWidth", { configurable: true, get: () => 1920 });
  Object.defineProperty(HTMLVideoElement.prototype, "videoHeight", { configurable: true, get: () => 1080 });
  HTMLMediaElement.prototype.play = () => Promise.resolve();
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
    if (u.includes("/desktop/offer")) {
      window.__offers.push(JSON.parse(opt?.body || "{}"));
      return new Response(JSON.stringify({ answer: { type: "answer", sdp: "" } }), { status: 200 });
    }
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
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
await page.addInitScript(init);
const results = {};

const approx = (actual, expected, eps = 0.015) => Math.abs(actual - expected) <= eps;
const has = (arr, pred) => Array.isArray(arr) && arr.some(pred);
const assertCoordEvents = (events, wantX, wantY) => {
  if (!Array.isArray(events) || events.length < 3) throw new Error(`not enough pointer events: ${JSON.stringify(events)}`);
  const tail = events.slice(-3);
  const types = tail.map((m) => m.t).join(",");
  if (types !== "move,down,up") throw new Error(`pointer event types ${types}: ${JSON.stringify(tail)}`);
  for (const m of tail) {
    if (!approx(m.x, wantX) || !approx(m.y, wantY)) {
      throw new Error(`bad coords for ${m.t}: ${JSON.stringify(m)}, want ${wantX},${wantY}`);
    }
  }
  return tail;
};
const assertAtomicClicks = (events, expected) => {
  const clicks = events.filter((event) => event.t === "click");
  const matches = clicks.length === expected.length && clicks.every((event, index) => {
    const want = expected[index];
    return event.t === want.t && event.b === want.b && event.c === want.c &&
      approx(event.x, want.x) && approx(event.y, want.y);
  });
  if (!matches) {
    throw new Error(`atomic clicks ${JSON.stringify(clicks)}, want ${JSON.stringify(expected)}`);
  }
  return clicks;
};

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
  results.initialQuality = await page.evaluate(() => window.__offers[0]?.quality);
  results.qualityReconnect = await (async () => {
    await page.selectOption(".rd-quality select", "ultra");
    await page.waitForTimeout(100);
    return page.evaluate(() => ({ count: window.__offers.length, quality: window.__offers.at(-1)?.quality }));
  })();

  const sentAfter = async (fn, settleMs = 50) => {
    await page.evaluate(() => (window.__sent = []));
    await fn();
    await page.waitForTimeout(settleMs);
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
  const clickKey = (label) =>
    page.evaluate((lbl) => {
      const btn = [...document.querySelectorAll(".rd-keys button")].find(
        (b) => b.textContent.trim() === lbl,
      );
      if (!btn) throw new Error("no button " + lbl);
      btn.click();
    }, label);
  const activateKey = (label) =>
    page.evaluate((lbl) => {
      const btn = [...document.querySelectorAll(".rd-keys button")].find(
        (b) => b.textContent.trim() === lbl,
      );
      if (!btn) throw new Error("no button " + lbl);
      btn.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true }));
      btn.click();
    }, label);
  const pointForNorm = async (x, y) =>
    page.locator("video.rd-video").evaluate((video, target) => {
      const r = video.getBoundingClientRect();
      const vw = video.videoWidth || r.width;
      const vh = video.videoHeight || r.height;
      const scale = Math.min(r.width / vw, r.height / vh);
      const dispW = vw * scale;
      const dispH = vh * scale;
      const offX = r.left + (r.width - dispW) / 2;
      const offY = r.top + (r.height - dispH) / 2;
      return { x: offX + dispW * target.x, y: offY + dispH * target.y };
    }, { x, y });

  results.backspaceBtn = await sentAfter(() => tapKey("⌫"));
  results.enterBtn = await sentAfter(() => tapKey("Enter"));
  results.escBtn = await sentAfter(() => tapKey("Esc"));
  results.arrowUpBtn = await sentAfter(() => clickKey("↑"));
  results.arrowDownActivation = await sentAfter(() => activateKey("↓"));
  // Combo: arm ctrl (on-screen) then type c in hidden field
  results.comboCtrlC = await sentAfter(async () => {
    await tapKey("ctrl");
    await page.locator(".rd-kbd").focus();
    await page.keyboard.press("c");
  });
  // Typing text
  results.typing = await sentAfter(async () => {
    await page.locator(".rd-kbd").focus();
    await page.keyboard.type("ab");
  });

  const p = await pointForNorm(0.25, 0.5);
  const q = await pointForNorm(0.75, 0.25);
  results.pointerMove = await sentAfter(() => page.mouse.move(q.x, q.y));
  results.mouseSingle = assertAtomicClicks(await sentAfter(
    () => page.mouse.click(p.x, p.y),
    380,
  ), [{ t: "click", x: 0.25, y: 0.5, b: 0, c: 1 }]);
  results.mouseDouble = assertAtomicClicks(await sentAfter(
    () => page.mouse.dblclick(p.x, p.y, { delay: 40 }),
  ), [{ t: "click", x: 0.25, y: 0.5, b: 0, c: 2 }]);
  results.mouseRight = assertAtomicClicks(await sentAfter(
    () => page.mouse.click(q.x, q.y, { button: "right" }),
  ), [{ t: "click", x: 0.75, y: 0.25, b: 2, c: 1 }]);
  results.mouseMixedButtons = assertAtomicClicks(await sentAfter(async () => {
    await page.mouse.click(p.x, p.y);
    await page.waitForTimeout(40);
    await page.mouse.click(q.x, q.y, { button: "right" });
  }), [
    { t: "click", x: 0.25, y: 0.5, b: 0, c: 1 },
    { t: "click", x: 0.75, y: 0.25, b: 2, c: 1 },
  ]);
  results.contextMenuSuppressed = await page.evaluate(() =>
    window.__contextMenus.length > 0 && window.__contextMenus.at(-1).defaultPrevented,
  );
  results.mouseDifferentCoordinate = assertAtomicClicks(await sentAfter(async () => {
    await page.mouse.click(p.x, p.y);
    await page.waitForTimeout(40);
    await page.mouse.click(q.x, q.y);
  }, 380), [
    { t: "click", x: 0.25, y: 0.5, b: 0, c: 1 },
    { t: "click", x: 0.75, y: 0.25, b: 0, c: 1 },
  ]);
  results.mouseOutsideDoubleWindow = assertAtomicClicks(await sentAfter(async () => {
    await page.mouse.click(p.x, p.y);
    await page.waitForTimeout(360);
    await page.mouse.click(p.x, p.y);
  }, 380), [
    { t: "click", x: 0.25, y: 0.5, b: 0, c: 1 },
    { t: "click", x: 0.25, y: 0.5, b: 0, c: 1 },
  ]);
  results.mouseDrag = await sentAfter(async () => {
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await page.mouse.move(p.x + 30, p.y + 20);
    await page.mouse.up();
  });
  results.scroll = await sentAfter(async () => {
    await page.mouse.move(p.x, p.y);
    await page.mouse.wheel(0, 120);
  });

  await page.click('button[title="Zoom in"]');
  await page.waitForTimeout(50);
  results.panGesture = await sentAfter(() => page.evaluate(({ x, y }) => {
    const target = document.querySelector(".rd-viewport");
    const touches = (dx, dy, halfDistance) => [
      new Touch({ identifier: 1, target, clientX: x - halfDistance + dx, clientY: y + dy }),
      new Touch({ identifier: 2, target, clientX: x + halfDistance + dx, clientY: y + dy }),
    ];
    const start = touches(0, 0, 50);
    target.dispatchEvent(new TouchEvent("touchstart", { bubbles: true, cancelable: true, touches: start, changedTouches: start }));
    const moved = touches(20, 10, 60);
    target.dispatchEvent(new TouchEvent("touchmove", { bubbles: true, cancelable: true, touches: moved, changedTouches: moved }));
    target.dispatchEvent(new TouchEvent("touchend", { bubbles: true, cancelable: true, touches: [], changedTouches: moved }));
  }, p), 380);
  results.panTransform = await page.locator(".rd-video").getAttribute("style");
  const zoomed = await pointForNorm(0.75, 0.25);
  results.zoomedClick = assertAtomicClicks(await sentAfter(
    () => page.mouse.click(zoomed.x, zoomed.y),
    380,
  ), [{ t: "click", x: 0.75, y: 0.25, b: 0, c: 1 }]);
  await page.click('button[title="Fit to screen"]');

  await page.click('button:has-text("Touchpad")'); // switch to direct-touch
  results.directTouch = assertCoordEvents(await sentAfter(async () => {
    const touch = { identifier: 1, clientX: p.x, clientY: p.y, pageX: p.x, pageY: p.y, screenX: p.x, screenY: p.y };
    await page.locator(".rd-viewport").dispatchEvent("touchstart", {
      touches: [touch],
      changedTouches: [touch],
    });
    await page.locator(".rd-viewport").dispatchEvent("touchend", {
      touches: [],
      changedTouches: [touch],
    });
  }), 0.25, 0.5);

  await page.click('button:has-text("Direct")'); // switch back to touchpad
  const touchAt = async (point, holdMs = 0) => {
    const touch = { identifier: 1, clientX: point.x, clientY: point.y, pageX: point.x, pageY: point.y, screenX: point.x, screenY: point.y };
    await page.locator(".rd-viewport").dispatchEvent("touchstart", {
      touches: [touch],
      changedTouches: [touch],
    });
    if (holdMs) await page.waitForTimeout(holdMs);
    await page.locator(".rd-viewport").dispatchEvent("touchend", {
      touches: [],
      changedTouches: [touch],
    });
  };
  results.touchSingle = assertAtomicClicks(await sentAfter(
    () => touchAt(p),
    380,
  ), [{ t: "click", x: 0.25, y: 0.5, b: 0, c: 1 }]);
  results.touchDouble = assertAtomicClicks(await sentAfter(async () => {
    await touchAt(p);
    await page.waitForTimeout(40);
    await touchAt(p);
  }), [{ t: "click", x: 0.25, y: 0.5, b: 0, c: 2 }]);
  results.touchLongPress = assertAtomicClicks(await sentAfter(
    () => touchAt(q, 600),
  ), [{ t: "click", x: 0.75, y: 0.25, b: 2, c: 1 }]);
} catch (e) {
  results.error = String(e);
}

console.log(JSON.stringify(results, null, 2));
const ok =
  results.nodeListed &&
  results.viewerOpened &&
  results.initialQuality?.encode_height === 1080 &&
  results.initialQuality?.bitrate === "8M" &&
  results.initialQuality?.fps === 30 &&
  results.qualityReconnect?.count >= 2 &&
  results.qualityReconnect?.quality?.encode_height === 1440 &&
  results.qualityReconnect?.quality?.bitrate === "14M" &&
  results.qualityReconnect?.quality?.fps === 30 &&
  has(results.backspaceBtn, (m) => m.t === "key" && m.k === "Backspace") &&
  has(results.enterBtn, (m) => m.t === "key" && m.k === "Enter") &&
  has(results.escBtn, (m) => m.t === "key" && m.k === "Escape") &&
  has(results.arrowUpBtn, (m) => m.t === "key" && m.k === "ArrowUp") &&
  results.arrowDownActivation?.filter((m) => m.t === "key" && m.k === "ArrowDown").length === 1 &&
  has(results.comboCtrlC, (m) => m.t === "key" && m.k === "c" && m.mods?.includes("ctrl")) &&
  has(results.typing, (m) => m.t === "text" && m.text === "a") &&
  has(results.typing, (m) => m.t === "text" && m.text === "b") &&
  has(results.pointerMove, (m) => m.t === "move" && approx(m.x, 0.75) && approx(m.y, 0.25)) &&
  results.mouseSingle?.length === 1 &&
  results.mouseDouble?.length === 1 &&
  results.mouseRight?.length === 1 &&
  results.mouseMixedButtons?.length === 2 &&
  results.contextMenuSuppressed === true &&
  results.mouseDifferentCoordinate?.length === 2 &&
  results.mouseOutsideDoubleWindow?.length === 2 &&
  has(results.mouseDrag, (m) => m.t === "down" && m.b === 0) &&
  has(results.mouseDrag, (m) => m.t === "up" && m.b === 0) &&
  !has(results.mouseDrag, (m) => m.t === "click") &&
  has(results.scroll, (m) => m.t === "scroll" && m.dy === 120) &&
  results.panGesture?.length === 0 &&
  results.panTransform?.includes("translate(20px, 10px)") &&
  results.zoomedClick?.length === 1 &&
  Array.isArray(results.directTouch) &&
  results.touchSingle?.length === 1 &&
  results.touchDouble?.length === 1 &&
  results.touchLongPress?.length === 1 &&
  !results.error;
await browser.close();
server.close();
if (!ok) {
  console.error("rd self-test failed");
  process.exit(1);
}
