// Command envd-desktop serves a WebRTC remote-desktop session: it captures the
// host screen, streams H.264 to a browser, and injects pointer/keyboard input
// received over a data channel. It is the companion binary for envd's remote
// desktop capability.
//
// Signaling requires a bearer token (ENVD_DESKTOP_TOKEN) unless -token "" is
// passed explicitly; input injection is powerful so the endpoint must not be
// anonymous. Deploy behind TLS (or reachable only via the authenticated envd
// tunnel).
package main

import (
	"flag"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	desktop "github.com/fractalmind-ai/envd-desktop"
	"github.com/pion/webrtc/v4"
)

func main() {
	var (
		bind     = flag.String("bind", ":8090", "HTTP listen address")
		display  = flag.String("display", "", "capture source (Linux X display e.g. :0 ; macOS avfoundation index e.g. 0)")
		width    = flag.Int("width", 0, "real screen width for pointer mapping (0 = auto-detect)")
		height   = flag.Int("height", 0, "real screen height for pointer mapping (0 = auto-detect)")
		pixFmt   = flag.String("pixel-format", "", "capture input pixel format (macOS avfoundation is usually uyvy422)")
		fps      = flag.Int("fps", 25, "capture frame rate")
		bitrate  = flag.String("bitrate", "4M", "VP8 target bitrate")
		encH     = flag.Int("encode-height", 720, "encoded video height (720/1080/1440; capped to screen height)")
		token    = flag.String("token", os.Getenv("ENVD_DESKTOP_TOKEN"), "signaling bearer token (empty disables auth)")
		stunURLs = flag.String("stun", "stun:stun.l.google.com:19302", "comma-separated STUN/TURN urls")
		turnURL  = flag.String("turn", "", "optional TURN url (e.g. turn:host:3478)")
		turnUser = flag.String("turn-user", "", "TURN username")
		turnPass = flag.String("turn-pass", "", "TURN credential")
		certFile = flag.String("cert", "", "TLS certificate file (enables HTTPS)")
		keyFile  = flag.String("key", "", "TLS key file")
	)
	flag.Parse()

	var ice []webrtc.ICEServer
	for _, u := range strings.Split(*stunURLs, ",") {
		if u = strings.TrimSpace(u); u != "" {
			ice = append(ice, webrtc.ICEServer{URLs: []string{u}})
		}
	}
	if *turnURL != "" {
		ice = append(ice, webrtc.ICEServer{
			URLs:       []string{*turnURL},
			Username:   *turnUser,
			Credential: *turnPass,
		})
	}

	if *token == "" {
		log.Printf("[desktop] WARNING: signaling auth DISABLED (-token empty); anyone who can reach %s can control this host", *bind)
	}

	// Resolve the pointer-mapping screen size. Explicit flags win; otherwise
	// auto-detect the host's logical display so clicks land correctly (incl.
	// Retina) without an operator passing -width/-height.
	sw, sh := *width, *height
	if sw <= 0 || sh <= 0 {
		if dw, dh, ok := desktop.DetectDisplaySize(); ok {
			sw, sh = dw, dh
			log.Printf("[desktop] auto-detected display %dx%d for pointer mapping", sw, sh)
		} else {
			sw, sh = 1280, 720
			log.Printf("[desktop] display auto-detect failed; falling back to %dx%d (pass -width/-height to override)", sw, sh)
		}
	}

	h := desktop.Handler(desktop.HTTPConfig{
		Token: *token,
		Server: desktop.ServerConfig{
			ICEServers: ice,
			Capture: desktop.CaptureConfig{
				Display:      *display,
				Width:        sw,
				Height:       sh,
				FPS:          *fps,
				Bitrate:      *bitrate,
				EncodeHeight: *encH,
				PixelFormat:  *pixFmt,
			},
		},
	})

	srv := &http.Server{
		Addr:              *bind,
		Handler:           h,
		ReadHeaderTimeout: 10 * time.Second,
	}

	if *certFile != "" && *keyFile != "" {
		log.Printf("[desktop] listening on %s (HTTPS), capture %dx%d@%dfps encode_height=%d bitrate=%s display=%q", *bind, sw, sh, *fps, *encH, *bitrate, *display)
		log.Fatal(srv.ListenAndServeTLS(*certFile, *keyFile))
	}
	log.Printf("[desktop] listening on %s (HTTP), capture %dx%d@%dfps encode_height=%d bitrate=%s display=%q", *bind, sw, sh, *fps, *encH, *bitrate, *display)
	log.Fatal(srv.ListenAndServe())
}
