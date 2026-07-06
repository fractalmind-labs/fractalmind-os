# envd-desktop

WebRTC remote-desktop companion for envd. Captures the host screen, streams
H.264 to a browser (phone or laptop), and injects pointer/keyboard input from a
WebRTC data channel. Option 2 (pion WebRTC) from the remote-desktop design.

It is a **separate Go module** (own `go.mod`) so its pion/webrtc dependency graph
does not collide with envd's relay pion/turn+stun graph.

## Build

```bash
cd desktop
go build ./cmd/envd-desktop
```

Runtime deps on the host being controlled:
- `ffmpeg` (screen capture + H.264 encode)
- Linux: `xdotool` (input injection), an X display (`:0`, or `Xvfb`)
- macOS: `cliclick` (input injection); grant the process **Screen Recording**
  and **Accessibility** permissions in System Settings (TCC — must be done
  interactively on the machine)

## Run

```bash
# Linux (X display :0)
ENVD_DESKTOP_TOKEN=$(openssl rand -hex 16) \
  ./envd-desktop -bind :8090 -display :0 -width 1280 -height 720

# macOS (avfoundation screen index 1)
ENVD_DESKTOP_TOKEN=... ./envd-desktop -display 1 -width 1440 -height 900
```

Then open `https://<host>/?token=<token>` on the phone and tap **Connect**.

## Security

- Signaling requires a bearer token (`-token` / `ENVD_DESKTOP_TOKEN`). Input
  injection is full host control, so **never run with an empty token on a
  reachable interface**. A WARNING is logged if auth is disabled.
- Serve over TLS (`-cert`/`-key`) or expose only through the authenticated envd
  tunnel / a TLS reverse proxy.
- Behind NAT, provide a STUN and/or TURN server (`-stun`, `-turn`); envd's relay
  can serve as TURN.

## Endpoints

- `GET /` — mobile web client (embedded)
- `POST /offer` — SDP offer → answer (bearer/`?token=` auth)
- `GET /healthz`

## Layout

- `capture.go` — ffmpeg screen capture → Annex-B H.264 (per-OS args, unit-tested)
- `server.go` — pion peer connection, H.264 track, input data channel
- `input.go` — normalized pointer/keyboard events → xdotool/cliclick (unit-tested)
- `http.go` — signaling + embedded client + token auth
- `web/index.html` — mobile WebRTC client
- `smoke_test.go` (`-tags smoke`) — headless end-to-end negotiation test
