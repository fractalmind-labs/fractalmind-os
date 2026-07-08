import { useEffect, useRef, useState } from "react";

// WebRTC remote-desktop viewer. Ports the proven envd-desktop web client into a
// React component: recvonly VP8 video + an "input" data channel for pointer and
// keyboard, negotiated against the target's envd-desktop server
// (GET /ice, POST /offer). Both the pion server side and this client use the
// server-provided ICE servers (STUN/TURN) so cellular CGNAT is traversable.

interface Props {
  /** Base URL of the target's envd-desktop server (e.g. https://host or a tunnel). */
  url: string;
  token: string;
  onClose: () => void;
}

interface InputEvent {
  t: "move" | "down" | "up" | "key" | "scroll";
  x?: number;
  y?: number;
  b?: number;
  k?: string;
  down?: boolean;
  dy?: number;
}

export function RemoteDesktop({ url, token, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const [status, setStatus] = useState("connecting…");
  const base = url.replace(/\/+$/, "");
  const q = token ? `?token=${encodeURIComponent(token)}` : "";

  useEffect(() => {
    let closed = false;

    async function iceServers(): Promise<RTCIceServer[]> {
      try {
        const r = await fetch(`${base}/ice${q}`);
        if (r.ok) {
          const j = await r.json();
          if (j.iceServers?.length) return j.iceServers as RTCIceServer[];
        }
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

      const resp = await fetch(`${base}/offer${q}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ offer: pc.localDescription }),
      });
      if (!resp.ok) {
        setStatus(`signal failed: ${resp.status}`);
        return;
      }
      const { answer } = await resp.json();
      await pc.setRemoteDescription(answer);
    }

    connect().catch((e) => setStatus("error: " + (e as Error).message));
    return () => {
      closed = true;
      dcRef.current?.close();
      pcRef.current?.close();
    };
  }, [base, q]);

  const send = (ev: InputEvent) => {
    const dc = dcRef.current;
    if (dc && dc.readyState === "open") {
      try {
        dc.send(JSON.stringify(ev));
      } catch {
        /* ignore */
      }
    }
  };

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

  return (
    <div className="rd">
      <div className="rd-bar">
        <button onClick={onClose}>← Back</button>
        <span className="muted small">{status}</span>
        <button
          onClick={() => {
            const el = document.querySelector<HTMLInputElement>("#rd-kbd");
            el?.focus();
          }}
        >
          ⌨︎
        </button>
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
      <input
        id="rd-kbd"
        className="rd-kbd"
        autoComplete="off"
        onKeyDown={(e) => {
          e.preventDefault();
          send({ t: "key", k: e.key, down: true });
        }}
      />
    </div>
  );
}
