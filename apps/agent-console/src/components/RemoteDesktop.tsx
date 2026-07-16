import { useEffect, useRef, useState } from "react";
import type { CoordinatorClient } from "../lib/coordinator";

// WebRTC remote-desktop viewer. recvonly VP8 video + an "input" data channel for
// pointer and keyboard. Signaling (ICE + offer/answer) is relayed through the
// coordinator to the node's envd-desktop server, so there is no direct tunnel to
// the desktop; media (SRTP) still flows peer-to-peer or via the server-provided
// TURN so cellular CGNAT is traversable.

interface Props {
  client: CoordinatorClient;
  nodeId: string;
  onClose: () => void;
}

interface InputEvent {
  t: "move" | "down" | "up" | "key" | "text" | "scroll";
  x?: number;
  y?: number;
  b?: number;
  k?: string;
  down?: boolean;
  dy?: number;
  text?: string;
  mods?: string[];
}

// Sticky modifiers a user can arm from the on-screen bar; they apply to the
// next key/combo and then clear (like ToDesk's modifier row).
type Mod = "ctrl" | "alt" | "shift" | "cmd";

// Live connection stats surfaced in the overlay.
interface RtcStats {
  rttMs: number | null;
  kbps: number | null;
  fps: number | null;
  lossPct: number | null;
}

// Filler kept in the hidden capture input so the soft keyboard backspace
// always has content to delete and thus fires a delete event.
const KBD_FILLER = "   ";
type TouchMode = "direct" | "touchpad";

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 4;
const TAP_MS = 220;
const TAP_MOVE_PX = 10;
const DOUBLE_TAP_MS = 320;
const LONG_PRESS_MS = 550;

export function RemoteDesktop({ client, nodeId, onClose }: Props) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const kbdRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState("connecting…");
  // WebRTC live stats (ToDesk-style overlay): RTT, bitrate, FPS, loss.
  const [stats, setStats] = useState<RtcStats | null>(null);
  const [showStats, setShowStats] = useState(false);
  const statsPrevRef = useRef<{ ts: number; bytes: number; frames: number } | null>(null);
  // Session reliability: auto-reconnect on ICE failure/drop (network switch,
  // tab sleep, host restart). reconnectRef lets the toolbar trigger it manually.
  const [reconnecting, setReconnecting] = useState(false);
  const reconnectRef = useRef<(() => void) | null>(null);
  // Controlling = input is forwarded to the host. When released, the stream
  // keeps playing but pointer/keyboard do nothing (so the user can look/scroll
  // the page without driving the remote machine).
  const [controlling, setControlling] = useState(true);
  const controllingRef = useRef(true);
  const [mods, setMods] = useState<Mod[]>([]);
  const modsRef = useRef<Mod[]>([]);
  const [touchMode, setTouchMode] = useState<TouchMode>("touchpad");
  const touchModeRef = useRef<TouchMode>("touchpad");
  const [zoom, setZoomState] = useState(1);
  const zoomRef = useRef(1);
  const [pan, setPanState] = useState({ x: 0, y: 0 });
  const panRef = useRef({ x: 0, y: 0 });
  const touchRef = useRef<{
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
    startTime: number;
    moved: boolean;
    remoteDown: boolean;
    lastTapTime: number;
    longPressTimer?: number;
    pinchStartDist?: number;
    pinchStartZoom?: number;
    pinchStartPan?: { x: number; y: number };
    pinchMid?: { x: number; y: number };
  }>({ startX: 0, startY: 0, lastX: 0, lastY: 0, startTime: 0, moved: false, remoteDown: false, lastTapTime: 0 });
  modsRef.current = mods;
  controllingRef.current = controlling;
  touchModeRef.current = touchMode;

  const clampZoom = (v: number) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, v));
  const setZoom = (next: number) => {
    const z = clampZoom(next);
    zoomRef.current = z;
    setZoomState(z);
    if (z <= 1) setPan({ x: 0, y: 0 });
  };
  const setPan = (next: { x: number; y: number }) => {
    panRef.current = next;
    setPanState(next);
  };

  useEffect(() => {
    let closed = false;

    async function iceServers(): Promise<RTCIceServer[]> {
      try {
        const j = await client.desktopICE(nodeId);
        if (j.iceServers?.length) return j.iceServers;
      } catch {
        /* fall back */
      }
      return [{ urls: "stun:stun.l.google.com:19302" }];
    }

    let attempts = 0;
    let retryTimer: number | undefined;
    let dropTimer: number | undefined;

    async function connect() {
      pcRef.current?.close();
      const pc = new RTCPeerConnection({ iceServers: await iceServers() });
      if (closed) {
        pc.close();
        return;
      }
      pcRef.current = pc;
      pc.addTransceiver("video", { direction: "recvonly" });
      const dc = pc.createDataChannel("input", { ordered: true });
      dcRef.current = dc;
      dc.onopen = () => {
        if (closed) return;
        attempts = 0;
        setReconnecting(false);
        setStatus("connected · 端到端加密 (DTLS-SRTP) 已建立");
      };
      pc.ontrack = (e) => {
        if (videoRef.current) {
          videoRef.current.srcObject = e.streams[0];
          videoRef.current.play().catch(() => {});
        }
      };
      pc.oniceconnectionstatechange = () => {
        if (closed) return;
        const st = pc.iceConnectionState;
        setStatus(st);
        if (st === "connected" || st === "completed") {
          window.clearTimeout(dropTimer);
          attempts = 0;
          setReconnecting(false);
        } else if (st === "failed") {
          scheduleReconnect();
        } else if (st === "disconnected") {
          // A brief disconnect often self-heals; only reconnect if it persists.
          window.clearTimeout(dropTimer);
          dropTimer = window.setTimeout(() => {
            if (!closed && pcRef.current === pc && pc.iceConnectionState === "disconnected")
              scheduleReconnect();
          }, 4000);
        }
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await new Promise<void>((res) => {
        if (pc.iceGatheringState === "complete") return res();
        const check = () => {
          if (pc.iceGatheringState === "complete") {
            pc.removeEventListener("icegatheringstatechange", check);
            res();
          }
        };
        pc.addEventListener("icegatheringstatechange", check);
        setTimeout(res, 4000);
      });
      // Bail if unmounted or superseded by a newer connect() (which closed pc).
      if (closed || pcRef.current !== pc) return;

      const { answer } = await client.desktopOffer(nodeId, pc.localDescription!);
      if (closed || pcRef.current !== pc) return;
      await pc.setRemoteDescription(answer);
    }

    function scheduleReconnect() {
      if (closed) return;
      window.clearTimeout(retryTimer);
      if (attempts >= 8) {
        setReconnecting(false);
        setStatus("disconnected — tap Reconnect");
        return;
      }
      const delay = Math.min(1000 * 2 ** attempts, 15000);
      attempts += 1;
      setReconnecting(true);
      setStatus(`reconnecting… (${attempts})`);
      retryTimer = window.setTimeout(() => {
        connect().catch((e) => setStatus("error: " + (e as Error).message));
      }, delay);
    }

    // Manual reconnect from the toolbar: reset backoff and retry now.
    reconnectRef.current = () => {
      window.clearTimeout(retryTimer);
      window.clearTimeout(dropTimer);
      attempts = 0;
      setReconnecting(true);
      setStatus("reconnecting…");
      connect().catch((e) => setStatus("error: " + (e as Error).message));
    };

    connect().catch((e) => {
      setStatus("error: " + (e as Error).message);
      scheduleReconnect();
    });

    // Poll WebRTC stats once a second for the overlay. Bitrate/FPS are computed
    // from deltas of the inbound video report; RTT comes from the active
    // candidate pair; loss from cumulative packetsLost/received.
    const statsTimer = window.setInterval(async () => {
      const pc = pcRef.current;
      if (!pc) return;
      try {
        const report = await pc.getStats();
        let rttMs: number | null = null;
        let bytes = 0;
        let frames = 0;
        let fps: number | null = null;
        let lost = 0;
        let recv = 0;
        report.forEach((r) => {
          if (r.type === "candidate-pair" && (r.nominated || r.state === "succeeded") && r.currentRoundTripTime != null)
            rttMs = Math.round(r.currentRoundTripTime * 1000);
          if (r.type === "inbound-rtp" && r.kind === "video") {
            bytes = r.bytesReceived || 0;
            frames = r.framesDecoded || 0;
            if (r.framesPerSecond != null) fps = Math.round(r.framesPerSecond);
            lost = r.packetsLost || 0;
            recv = r.packetsReceived || 0;
          }
        });
        const now = performance.now();
        const prev = statsPrevRef.current;
        let kbps: number | null = null;
        if (prev) {
          const dt = (now - prev.ts) / 1000;
          if (dt > 0) {
            kbps = Math.round(((bytes - prev.bytes) * 8) / dt / 1000);
            if (fps == null) fps = Math.round((frames - prev.frames) / dt);
          }
        }
        statsPrevRef.current = { ts: now, bytes, frames };
        const lossPct = lost + recv > 0 ? Math.round((lost / (lost + recv)) * 1000) / 10 : null;
        if (!closed) setStats({ rttMs, kbps, fps, lossPct });
      } catch {
        /* stats unavailable this tick */
      }
    }, 1000);

    return () => {
      closed = true;
      window.clearInterval(statsTimer);
      window.clearTimeout(retryTimer);
      window.clearTimeout(dropTimer);
      reconnectRef.current = null;
      dcRef.current?.close();
      pcRef.current?.close();
    };
  }, [client, nodeId]);

  const send = (ev: InputEvent) => {
    if (!controllingRef.current) return;
    const dc = dcRef.current;
    if (dc && dc.readyState === "open") {
      try {
        dc.send(JSON.stringify(ev));
      } catch {
        /* ignore */
      }
    }
  };

  // Send a key with the currently armed modifiers, then disarm them.
  const sendKey = (k: string) => {
    const m = modsRef.current;
    send({ t: "key", k, down: true, mods: m.length ? m : undefined });
    if (m.length) setMods([]);
  };

  const sendClick = (x: number, y: number, b = 0) => {
    const p = norm(x, y);
    send({ t: "move", x: p.x, y: p.y });
    // Darwin/cliclick button down/up commands are coordinate-bearing
    // (`dd:x,y` / `du:x,y`). Include the same normalized point on the button
    // events, not just the preceding move, otherwise the host may click at the
    // injector default (0,0) even though the cursor was moved correctly.
    send({ t: "down", x: p.x, y: p.y, b });
    send({ t: "up", x: p.x, y: p.y, b });
  };

  const toggleMod = (m: Mod) =>
    setMods((cur) => (cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m]));

  const focusKeyboard = () => kbdRef.current?.focus();

  const resetView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const actualSize = () => {
    const v = videoRef.current;
    const viewport = viewportRef.current;
    if (!v || !viewport) return;
    const r = viewport.getBoundingClientRect();
    const intrinsicW = v.videoWidth || r.width;
    const intrinsicH = v.videoHeight || r.height;
    const fitScale = Math.min(r.width / Math.max(1, intrinsicW), r.height / Math.max(1, intrinsicH));
    const next = fitScale > 0 ? 1 / fitScale : 1;
    setZoom(next);
    setPan({ x: 0, y: 0 });
  };

  // Map a pointer position on the (object-fit: contain) transformed video to normalized [0,1].
  const norm = (clientX: number, clientY: number) => {
    const v = videoRef.current;
    if (!v) return { x: 0, y: 0 };
    const r = v.getBoundingClientRect();
    const vw = v.videoWidth || r.width;
    const vh = v.videoHeight || r.height;
    const scale = Math.min(r.width / vw, r.height / vh);
    const dispW = vw * scale;
    const dispH = vh * scale;
    const offX = r.left + (r.width - dispW) / 2;
    const offY = r.top + (r.height - dispH) / 2;
    const x = (clientX - offX) / dispW;
    const y = (clientY - offY) / dispH;
    return { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) };
  };

  const touchDistance = (ts: React.TouchList) => {
    if (ts.length < 2) return 0;
    const dx = ts[0].clientX - ts[1].clientX;
    const dy = ts[0].clientY - ts[1].clientY;
    return Math.hypot(dx, dy);
  };

  const touchMid = (ts: React.TouchList) => ({
    x: (ts[0].clientX + ts[1].clientX) / 2,
    y: (ts[0].clientY + ts[1].clientY) / 2,
  });

  const clearLongPress = () => {
    if (touchRef.current.longPressTimer) window.clearTimeout(touchRef.current.longPressTimer);
    touchRef.current.longPressTimer = undefined;
  };

  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (e.touches.length >= 2) {
      clearLongPress();
      if (touchRef.current.remoteDown) {
        // Direct-touch may already be holding the remote button for a drag;
        // release it before switching into pinch/scroll handling so the host
        // never gets stuck with the mouse button held down.
        const p = norm(touchRef.current.lastX, touchRef.current.lastY);
        send({ t: "up", x: p.x, y: p.y, b: 0 });
      }
      const mid = touchMid(e.touches);
      touchRef.current = {
        ...touchRef.current,
        startX: mid.x,
        startY: mid.y,
        lastX: mid.x,
        lastY: mid.y,
        moved: false,
        remoteDown: false,
        pinchStartDist: touchDistance(e.touches),
        pinchStartZoom: zoomRef.current,
        pinchStartPan: panRef.current,
        pinchMid: mid,
      };
      return;
    }

    const t = e.touches[0];
    const now = Date.now();
    touchRef.current = {
      startX: t.clientX,
      startY: t.clientY,
      lastX: t.clientX,
      lastY: t.clientY,
      startTime: now,
      moved: false,
      remoteDown: false,
      lastTapTime: touchRef.current.lastTapTime,
    };

    if (!controllingRef.current) return;

    if (touchModeRef.current === "direct") {
      const p = norm(t.clientX, t.clientY);
      send({ t: "move", x: p.x, y: p.y });
      send({ t: "down", x: p.x, y: p.y, b: 0 });
      touchRef.current.remoteDown = true;
    } else {
      touchRef.current.longPressTimer = window.setTimeout(() => {
        sendClick(t.clientX, t.clientY, 2);
        touchRef.current.moved = true;
      }, LONG_PRESS_MS);
    }
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    e.preventDefault();
    const state = touchRef.current;
    if (e.touches.length >= 2) {
      clearLongPress();
      const mid = touchMid(e.touches);
      const dist = touchDistance(e.touches);
      const startDist = state.pinchStartDist || dist;
      const startZoom = state.pinchStartZoom || zoomRef.current;
      const pinchDelta = Math.abs(dist - startDist);
      const midDY = mid.y - state.lastY;
      if (controllingRef.current && touchModeRef.current === "touchpad" && pinchDelta < 10 && Math.abs(midDY) > 6) {
        // Two-finger touchpad gesture scrolls the remote host when it is not a pinch.
        send({ t: "scroll", dy: midDY });
        state.lastX = mid.x;
        state.lastY = mid.y;
        return;
      }
      const ratio = startDist ? dist / startDist : 1;
      setZoom(startZoom * ratio);
      if (state.pinchMid && state.pinchStartPan) {
        setPan({
          x: state.pinchStartPan.x + mid.x - state.pinchMid.x,
          y: state.pinchStartPan.y + mid.y - state.pinchMid.y,
        });
      }
      state.lastX = mid.x;
      state.lastY = mid.y;
      return;
    }

    const t = e.touches[0];
    const dx = t.clientX - state.lastX;
    const dy = t.clientY - state.lastY;
    const total = Math.hypot(t.clientX - state.startX, t.clientY - state.startY);
    if (total > TAP_MOVE_PX) {
      state.moved = true;
      clearLongPress();
    }

    if (!controllingRef.current) {
      if (zoomRef.current > 1) setPan({ x: panRef.current.x + dx, y: panRef.current.y + dy });
    } else if (touchModeRef.current === "direct") {
      const p = norm(t.clientX, t.clientY);
      send({ t: "move", x: p.x, y: p.y });
    } else if (touchModeRef.current === "touchpad") {
      // Touchpad mode: moving one finger moves the remote cursor without holding a button.
      const p = norm(t.clientX, t.clientY);
      send({ t: "move", x: p.x, y: p.y });
    }

    state.lastX = t.clientX;
    state.lastY = t.clientY;
  };

  const handleTouchEnd = (e: React.TouchEvent<HTMLDivElement>) => {
    e.preventDefault();
    clearLongPress();
    const state = touchRef.current;
    if (state.remoteDown) {
      const p = norm(state.lastX, state.lastY);
      send({ t: "up", x: p.x, y: p.y, b: 0 });
    }
    const elapsed = Date.now() - state.startTime;
    const isTap = !state.moved && elapsed <= TAP_MS;
    if (controllingRef.current && touchModeRef.current === "touchpad" && isTap) {
      const isDouble = Date.now() - state.lastTapTime <= DOUBLE_TAP_MS;
      // First tap sends one click; the second tap sends one more click, which
      // is the browser/OS-standard double-click sequence. Do not send an extra
      // third click on the second tap.
      sendClick(state.startX, state.startY, 0);
      state.lastTapTime = Date.now();
      if (isDouble) state.moved = true;
    }
    state.remoteDown = false;
    state.pinchStartDist = undefined;
    state.pinchStartZoom = undefined;
    state.pinchStartPan = undefined;
    state.pinchMid = undefined;
  };

  const down = useRef(false);
  const onScreenActionRef = useRef<{ id: string; at: number; source: "pointer" | "click" } | null>(null);
  const SPECIAL: { label: string; k: string }[] = [
    { label: "Esc", k: "Escape" },
    { label: "Tab", k: "Tab" },
    { label: "Enter", k: "Enter" },
    { label: "⌫", k: "Backspace" },
    { label: "←", k: "ArrowLeft" },
    { label: "↑", k: "ArrowUp" },
    { label: "↓", k: "ArrowDown" },
    { label: "→", k: "ArrowRight" },
  ];
  const MODS: Mod[] = ["ctrl", "alt", "shift", "cmd"];

  const markOnScreenAction = (id: string, source: "pointer" | "click") => {
    onScreenActionRef.current = { id, at: Date.now(), source };
  };

  const shouldSkipClickFallback = (id: string) => {
    const last = onScreenActionRef.current;
    return !!last && last.source === "pointer" && last.id === id && Date.now() - last.at < 700;
  };

  return (
    <div className="rd">
      <div className="rd-bar">
        <button onClick={onClose}>← Exit</button>
        <span className="muted small rd-status">
          {reconnecting ? "🔄 " : ""}
          {status}
        </span>
        <div className="rd-bar-actions">
          {(reconnecting || status.startsWith("disconnected") || status.startsWith("failed")) && (
            <button onClick={() => reconnectRef.current?.()} title="Reconnect now">
              🔄 Reconnect
            </button>
          )}
          <button onClick={() => setZoom(zoomRef.current - 0.25)} title="Zoom out">−</button>
          <button onClick={resetView} title="Fit to screen">Fit</button>
          <button onClick={actualSize} title="Actual size">1:1</button>
          <button onClick={() => setZoom(zoomRef.current + 0.25)} title="Zoom in">＋</button>
          <button
            className={touchMode === "touchpad" ? "on" : ""}
            onClick={() => {
              const next = touchMode === "touchpad" ? "direct" : "touchpad";
              touchModeRef.current = next;
              setTouchMode(next);
            }}
            title="Toggle touchpad/direct-touch mode"
          >
            {touchMode === "touchpad" ? "☝ Touchpad" : "👆 Direct"}
          </button>
          <button
            className={controlling ? "on" : ""}
            onClick={() => setControlling((c) => !c)}
            title="Toggle whether input drives the remote machine"
          >
            {controlling ? "🎮 Control" : "🔒 Released"}
          </button>
          <button onClick={focusKeyboard} title="Show keyboard">
            ⌨︎
          </button>
          <button
            className={showStats ? "on" : ""}
            onClick={() => setShowStats((s) => !s)}
            title="Connection stats"
          >
            📊
          </button>
        </div>
      </div>

      {showStats && (
        <div className="rd-stats small">
          <span>RTT {stats?.rttMs != null ? `${stats.rttMs}ms` : "–"}</span>
          <span>{stats?.kbps != null ? `${stats.kbps} kbps` : "– kbps"}</span>
          <span>{stats?.fps != null ? `${stats.fps} fps` : "– fps"}</span>
          <span>loss {stats?.lossPct != null ? `${stats.lossPct}%` : "–"}</span>
        </div>
      )}

      <div
        ref={viewportRef}
        className="rd-viewport"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
        onPointerDown={(e) => {
          if (e.pointerType === "touch") return;
          e.preventDefault();
          const p = norm(e.clientX, e.clientY);
          send({ t: "move", x: p.x, y: p.y });
          send({ t: "down", x: p.x, y: p.y, b: e.button || 0 });
          down.current = true;
        }}
        onPointerMove={(e) => {
          if (e.pointerType === "touch") return;
          if (!down.current && e.pointerType !== "mouse") return;
          const p = norm(e.clientX, e.clientY);
          send({ t: "move", x: p.x, y: p.y });
        }}
        onPointerUp={(e) => {
          if (e.pointerType === "touch") return;
          e.preventDefault();
          const p = norm(e.clientX, e.clientY);
          send({ t: "up", x: p.x, y: p.y, b: e.button || 0 });
          down.current = false;
        }}
        onContextMenu={(e) => e.preventDefault()}
        onWheel={(e) => {
          if (e.ctrlKey || !controllingRef.current) {
            e.preventDefault();
            setZoom(zoomRef.current + (e.deltaY < 0 ? 0.15 : -0.15));
          } else {
            send({ t: "scroll", dy: e.deltaY });
          }
        }}
      >
        <video
          ref={videoRef}
          className="rd-video"
          style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
          autoPlay
          playsInline
          muted
        />
      </div>

      <div className="rd-view-hint small muted">
        {Math.round(zoom * 100)}% · {touchMode === "touchpad" ? "触控板：点按/双击/长按/拖动光标" : "直触：按下即远端点击/拖拽"}
      </div>

      {controlling && (
        // preventDefault on pointer-down keeps the hidden input focused, so the
        // keyboard stays up while arming a modifier for a combo (e.g. ctrl + c).
        <div className="rd-keys" onPointerDown={(e) => e.preventDefault()}>
          {MODS.map((m) => {
            const actionId = `mod:${m}`;
            return (
              <button
                key={m}
                className={mods.includes(m) ? "on" : ""}
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  markOnScreenAction(actionId, "pointer");
                  toggleMod(m);
                  focusKeyboard();
                }}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (shouldSkipClickFallback(actionId)) return;
                  markOnScreenAction(actionId, "click");
                  toggleMod(m);
                  focusKeyboard();
                }}
              >
                {m}
              </button>
            );
          })}
          {SPECIAL.map((s) => {
            const actionId = `key:${s.k}`;
            return (
              <button
                key={s.k}
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  markOnScreenAction(actionId, "pointer");
                  sendKey(s.k);
                  focusKeyboard();
                }}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (shouldSkipClickFallback(actionId)) return;
                  markOnScreenAction(actionId, "click");
                  sendKey(s.k);
                  focusKeyboard();
                }}
              >
                {s.label}
              </button>
            );
          })}
          <button
            onPointerDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              markOnScreenAction("type", "pointer");
              focusKeyboard();
            }}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (shouldSkipClickFallback("type")) return;
              markOnScreenAction("type", "click");
              focusKeyboard();
            }}
            title="Type"
          >
            abc⌨︎
          </button>
        </div>
      )}

      {/* Hidden capture field. Kept filled with a filler buffer, not empty: on
          an empty field the mobile soft keyboard's backspace deletes nothing
          and fires no event (so delete "didn't work" and password entry broke).
          With filler, every backspace deletes a filler char and reliably fires
          deleteContentBackward; the buffer is reset after each event so no typed
          text (e.g. a password) lingers in the field. */}
      <input
        ref={kbdRef}
        className="rd-kbd"
        type="text"
        inputMode="text"
        autoComplete="off"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        defaultValue={KBD_FILLER}
        onInput={(e) => {
          const el = e.currentTarget;
          const ne = e.nativeEvent as unknown as { data?: string; inputType?: string };
          const it = ne.inputType || "";
          if (it === "insertLineBreak" || it === "insertParagraph") {
            sendKey("Enter");
          } else if (it.startsWith("delete")) {
            sendKey("Backspace");
          } else if (ne.data) {
            for (const chunk of ne.data.split(/(\r\n|\n|\r)/)) {
              if (!chunk) continue;
              if (chunk === "\n" || chunk === "\r" || chunk === "\r\n") sendKey("Enter");
              else send({ t: "text", text: chunk });
            }
          }
          // Restore the filler buffer with the caret at the end.
          el.value = KBD_FILLER;
          el.setSelectionRange(KBD_FILLER.length, KBD_FILLER.length);
        }}
        onKeyDown={(e) => {
          // Physical keyboards: printable chars go through onInput (IME-safe);
          // forward control/navigation keys and armed-modifier chords here.
          const m = modsRef.current;
          if (e.key.length === 1 && m.length === 0) return;
          if (e.key === "Shift" || e.key === "Control" || e.key === "Alt" || e.key === "Meta")
            return;
          e.preventDefault();
          sendKey(e.key);
        }}
      />
    </div>
  );
}
