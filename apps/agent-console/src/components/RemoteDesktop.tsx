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

    async function connect() {
      const pc = new RTCPeerConnection({ iceServers: await iceServers() });
      pcRef.current = pc;
      pc.addTransceiver("video", { direction: "recvonly" });
      const dc = pc.createDataChannel("input", { ordered: true });
      dcRef.current = dc;
      dc.onopen = () => setStatus("connected · 端到端加密 (DTLS-SRTP) 已建立");
      pc.ontrack = (e) => {
        if (videoRef.current) {
          videoRef.current.srcObject = e.streams[0];
          videoRef.current.play().catch(() => {});
        }
      };
      pc.oniceconnectionstatechange = () => !closed && setStatus(pc.iceConnectionState);

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

      const { answer } = await client.desktopOffer(nodeId, pc.localDescription!);
      await pc.setRemoteDescription(answer);
    }

    connect().catch((e) => setStatus("error: " + (e as Error).message));
    return () => {
      closed = true;
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
    send({ t: "down", b });
    send({ t: "up", b });
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
        send({ t: "up", b: 0 });
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
      send({ t: "down", b: 0 });
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
    if (state.remoteDown) send({ t: "up", b: 0 });
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

  return (
    <div className="rd">
      <div className="rd-bar">
        <button onClick={onClose}>← Exit</button>
        <span className="muted small rd-status">{status}</span>
        <div className="rd-bar-actions">
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
        </div>
      </div>

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
          send({ t: "down", b: e.button || 0 });
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
          send({ t: "up", b: e.button || 0 });
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
          {MODS.map((m) => (
            <button
              key={m}
              className={mods.includes(m) ? "on" : ""}
              onPointerDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                toggleMod(m);
                focusKeyboard();
              }}
              onClick={(e) => e.preventDefault()}
            >
              {m}
            </button>
          ))}
          {SPECIAL.map((s) => (
            <button
              key={s.k}
              onPointerDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                sendKey(s.k);
                focusKeyboard();
              }}
              onClick={(e) => e.preventDefault()}
            >
              {s.label}
            </button>
          ))}
          <button
            onPointerDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              focusKeyboard();
            }}
            onClick={(e) => e.preventDefault()}
            title="Type"
          >
            abc⌨︎
          </button>
        </div>
      )}

      {/* Hidden field: mobile IME commits go through onInput (reliable for
          composed/CJK text); Enter/Backspace/etc. come through onKeyDown. */}
      <input
        ref={kbdRef}
        className="rd-kbd"
        autoComplete="off"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        value=""
        onChange={() => {}}
        onInput={(e) => {
          // On mobile the return key may arrive as an inputType with no
          // key event, or as literal newline data from the IME. Map both to
          // remote Enter and only type real text data.
          const ne = e.nativeEvent as unknown as { data?: string; inputType?: string };
          if (ne.inputType === "insertLineBreak" || ne.inputType === "insertParagraph") {
            sendKey("Enter");
            return;
          }
          if (ne.inputType === "deleteContentBackward") {
            sendKey("Backspace");
            return;
          }
          if (!ne.data) return;
          for (const chunk of ne.data.split(/(\r\n|\n|\r)/)) {
            if (!chunk) continue;
            if (chunk === "\n" || chunk === "\r" || chunk === "\r\n") sendKey("Enter");
            else send({ t: "text", text: chunk });
          }
        }}
        onKeyDown={(e) => {
          // Printable single chars are handled by onInput to keep IME intact;
          // forward control/navigation keys and modified chords here.
          const m = modsRef.current;
          const isChar = e.key.length === 1 && m.length === 0;
          if (isChar) return;
          e.preventDefault();
          if (e.key === "Shift" || e.key === "Control" || e.key === "Alt" || e.key === "Meta")
            return;
          sendKey(e.key);
        }}
      />
    </div>
  );
}
