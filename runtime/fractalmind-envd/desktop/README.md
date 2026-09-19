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
- `ffmpeg` (screen capture + VP8 encode)
- Linux: `xdotool` (input injection), an X display (`:0`, or `Xvfb`)
- macOS: `cliclick` (input injection); grant the process **Screen Recording**
  and **Accessibility** permissions in System Settings (TCC — must be done
  interactively on the machine). The user must be logged in; `envd-desktop`
  cannot unlock the login window or bypass TCC prompts.

## Run

```bash
# Linux (X display :0)
ENVD_DESKTOP_TOKEN=$(openssl rand -hex 16) \
  ./envd-desktop -bind :8090 -display :0 -width 1280 -height 720

# macOS (avfoundation screen index 1), balanced quality (default 720p / 4M / 25fps)
ENVD_DESKTOP_TOKEN=... ./envd-desktop -display 1 -width 1440 -height 900

# Clear quality preset (1080p / 8M / 30fps)
ENVD_DESKTOP_TOKEN=... ./envd-desktop -display 1 -encode-height 1080 -bitrate 8M -fps 30

# Ultra quality preset (1440p / 14M / 30fps; capped to source height)
ENVD_DESKTOP_TOKEN=... ./envd-desktop -display 1 -encode-height 1440 -bitrate 14M -fps 30
```

Then open `https://<host>/?token=<token>` on the phone and tap **Connect**.

On macOS, `-keep-awake` is enabled by default. It starts `caffeinate -dims -w`
bound to the `envd-desktop` process and nudges user activity before each screen
capture, which prevents the display idle path that can make avfoundation stop
advancing frames. To disable it explicitly:

```bash
ENVD_DESKTOP_TOKEN=... ./envd-desktop -keep-awake=false
```

## Quality controls

`envd-desktop` always captures the native screen for correct pointer mapping, then scales the outgoing WebRTC stream. Quality can be set at startup and can also be overridden per `/offer` by newer Agent Console clients.

Recommended presets:

| Preset | Encode height | Bitrate | FPS | Use case |
| --- | ---: | ---: | ---: | --- |
| Smooth | 720 | 4M | 25 | slower networks / lowest CPU |
| Clear | 1080 | 8M | 30 | default recommended desktop control |
| Ultra | 1440 | 14M | 30 | local/LAN or strong uplink |

Startup flags:

```bash
./envd-desktop -encode-height 1080 -bitrate 8M -fps 30
```

The requested encode height is capped to the source screen height, so a 900px-tall display will not be upscaled to 1080p.

## Security

- Signaling requires a bearer token (`-token` / `ENVD_DESKTOP_TOKEN`). Input
  injection is full host control, so **never run with an empty token on a
  reachable interface**. A WARNING is logged if auth is disabled.
- Serve over TLS (`-cert`/`-key`) or expose only through the authenticated envd
  tunnel / a TLS reverse proxy.
- Behind NAT, provide a STUN and/or TURN server (`-stun`, `-turn`); envd's relay
  can serve as TURN.

## Black-screen troubleshooting

`ICE connected` only means WebRTC found a network path. It does not prove that
macOS capture is authorized or that video frames are arriving.

For macOS hosts:

1. Confirm Screen Recording (or Screen & System Audio Recording) is enabled for
   the exact launch subject: `envd` / `envd-desktop`, and also Terminal/iTerm or
   the wrapper app if they start the tmux session. Restart `envd-desktop` after
   changing TCC permissions.
2. Check `GET /status` through the coordinator or local desktop server. A healthy
   viewer should show `session.streaming=true`, increasing `frames_sent`, and a
   fresh `last_frame_at`.
3. If capture is active but the viewer is black and logs show
   `turnc ... CreatePermission error 400`, run a short A/B by starting without
   `-turn/-turn-user/-turn-pass` (STUN-only). If STUN-only works, fix the TURN
   service before re-enabling relay mode.

For coturn-based TURN:

- Avoid tiny relay pools. A small range such as `49160-49200` can exhaust during
  reconnect storms and produce `create_relay_ioa_sockets: no available ports`.
- Ensure the whole relay range is open in the cloud firewall/security group and
  local firewall, not only the listening port.
- When using `external-ip=<public-ip>` on a host with a private NIC, verify that
  coturn can bind relay sockets on the private address and advertise the public
  address consistently.

### Exact-artifact macOS runtime probe

Use this checklist for black-screen regressions that only appear on a supervised
macOS host. Unit tests can prove teardown sequencing and codec sanity, but they
do not prove a normal-session screen-capture regression is fixed.

1. Record the exact binaries before launch:

   ```bash
   shasum -a 256 ./envd ./envd-desktop
   git rev-parse HEAD
   ```

2. Start the worker through the same LaunchAgent or GUI-session supervisor used
   in production. Do not run `envd-desktop` from an SSH-only session for this
   probe.

3. Confirm desktop health and capture status before connecting a viewer:

   ```bash
   curl -fsS -H "Authorization: Bearer $ENVD_DESKTOP_TOKEN" \
     http://127.0.0.1:8090/healthz
   curl -fsS -H "Authorization: Bearer $ENVD_DESKTOP_TOKEN" \
     http://127.0.0.1:8090/status
   ```

4. Connect from the real browser client and wait for `ICE connected`. Poll
   `/status` twice at least five seconds apart and require `streaming=true`,
   increasing `frames_sent`, increasing `bytes_sent`, and fresh `last_frame_at`:

   ```bash
   curl -fsS -H "Authorization: Bearer $ENVD_DESKTOP_TOKEN" \
     http://127.0.0.1:8090/status > /tmp/envd-desktop-status-1.json
   sleep 5
   curl -fsS -H "Authorization: Bearer $ENVD_DESKTOP_TOKEN" \
     http://127.0.0.1:8090/status > /tmp/envd-desktop-status-2.json
   ```

5. In the connected browser, sample actual rendered video pixels from the
   `<video>` element. This measures the viewer-visible non-black condition; it
   is not replaced by `/status` counters.

   ```js
   const video = document.querySelector('video');
   const canvas = document.createElement('canvas');
   canvas.width = video.videoWidth;
   canvas.height = video.videoHeight;
   const ctx = canvas.getContext('2d', { willReadFrequently: true });
   ctx.drawImage(video, 0, 0);
   const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
   let nonBlack = 0;
   for (let i = 0; i < data.length; i += 4) {
     if (data[i] > 8 || data[i + 1] > 8 || data[i + 2] > 8) nonBlack++;
   }
   console.log({ width: canvas.width, height: canvas.height, nonBlack });
   ```

6. Exercise bounded recovery: hard-kill the supervised worker, wait for the
   LaunchAgent/supervisor restart, reconnect the browser, and repeat the
   `/healthz`, `/status`, and browser pixel checks. Then verify stale capture
   children were reaped:

   ```bash
   pgrep -fl envd-desktop
   pgrep -fl ffmpeg
   ps -axo pid,ppid,pgid,comm | egrep 'envd-desktop|ffmpeg'
   ```

The Issue #79 acceptance claim requires this real-host probe to pass with the
exact Darwin arm64 artifact. The synthetic IVF codec sanity test only verifies
that generated VP8/IVF frames decode to advancing non-black RGB frames.

## Endpoints

- `GET /` — mobile web client (embedded)
- `POST /offer` — SDP offer → answer (bearer/`?token=` auth)
- `GET /healthz`
- `GET /status` — token-gated desktop/session/media health

## Layout

- `capture.go` — ffmpeg screen capture → Annex-B H.264 (per-OS args, unit-tested)
- `server.go` — pion peer connection, H.264 track, input data channel
- `input.go` — normalized pointer/keyboard events → xdotool/cliclick (unit-tested)
- `http.go` — signaling + embedded client + token auth
- `web/index.html` — mobile WebRTC client
- `smoke_test.go` (`-tags smoke`) — headless end-to-end negotiation test
