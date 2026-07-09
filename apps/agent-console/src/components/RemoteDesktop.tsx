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
  t: "move" | "down" | "up" | "key" | "scroll";
  x?: number;
  y?: number;
  b?: number;
  k?: string;
  down?: boolean;
  dy?: number;
}

export function RemoteDesktop({ client, nodeId, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const [status, setStatus] = useState("connecting…");

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
