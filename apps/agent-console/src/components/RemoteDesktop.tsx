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

export function RemoteDesktop({ client, nodeId, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const kbdRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState("connecting…");
  // Controlling = input is forwarded to the host. When released, the stream
  // keeps playing but pointer/keyboard do nothing (so the user can look/scroll
  // the page without driving the remote machine).
  const [controlling, setControlling] = useState(true);
  const [mods, setMods] = useState<Mod[]>([]);
  const modsRef = useRef<Mod[]>([]);
  modsRef.current = mods;

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
    if (!controlling) return;
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

  const toggleMod = (m: Mod) =>
    setMods((cur) => (cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m]));

  const focusKeyboard = () => kbdRef.current?.focus();

  // Map a pointer position on the (object-fit: contain) video to normalized [0,1].
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

  const down = useRef(false);
  const SPECIAL: { label: string; k: string }[] = [
    { label: "Esc", k: "Escape" },
    { label: "Tab", k: "Tab" },
    { label: "⏎", k: "Enter" },
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

      <video
        ref={videoRef}
        className="rd-video"
        autoPlay
        playsInline
        muted
        onPointerDown={(e) => {
          e.preventDefault();
          const p = norm(e.clientX, e.clientY);
          send({ t: "move", x: p.x, y: p.y });
          send({ t: "down", b: e.button || 0 });
          down.current = true;
        }}
        onPointerMove={(e) => {
          if (!down.current && e.pointerType === "touch") return;
          const p = norm(e.clientX, e.clientY);
          send({ t: "move", x: p.x, y: p.y });
        }}
        onPointerUp={(e) => {
          e.preventDefault();
          send({ t: "up", b: e.button || 0 });
          down.current = false;
        }}
        onContextMenu={(e) => e.preventDefault()}
        onWheel={(e) => send({ t: "scroll", dy: e.deltaY })}
      />

      {controlling && (
        // preventDefault on pointer-down keeps the hidden input focused, so the
        // keyboard stays up while arming a modifier for a combo (e.g. ctrl + c).
        <div className="rd-keys" onPointerDown={(e) => e.preventDefault()}>
          {MODS.map((m) => (
            <button
              key={m}
              className={mods.includes(m) ? "on" : ""}
              onClick={() => toggleMod(m)}
            >
              {m}
            </button>
          ))}
          {SPECIAL.map((s) => (
            <button key={s.k} onClick={() => sendKey(s.k)}>
              {s.label}
            </button>
          ))}
          <button onClick={focusKeyboard} title="Type">
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
          // On mobile the return key arrives here as insertLineBreak with no
          // key event, so map input types to keys and only type real data.
          const ne = e.nativeEvent as unknown as { data?: string; inputType?: string };
          if (ne.inputType === "insertLineBreak" || ne.inputType === "insertParagraph") {
            sendKey("Enter");
            return;
          }
          if (ne.inputType === "deleteContentBackward") {
            sendKey("Backspace");
            return;
          }
          if (ne.data) send({ t: "text", text: ne.data });
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
