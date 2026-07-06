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
		display  = flag.String("display", "", "capture source (Linux X display e.g. :0 ; macOS avfoundation index e.g. 1)")
		width    = flag.Int("width", 1280, "capture width (also maps pointer coords)")
		height   = flag.Int("height", 720, "capture height")
		fps      = flag.Int("fps", 25, "capture frame rate")
		bitrate  = flag.String("bitrate", "4M", "H.264 target bitrate")
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

	h := desktop.Handler(desktop.HTTPConfig{
		Token: *token,
		Server: desktop.ServerConfig{
			ICEServers: ice,
			Capture: desktop.CaptureConfig{
				Display: *display,
				Width:   *width,
				Height:  *height,
				FPS:     *fps,
				Bitrate: *bitrate,
			},
		},
	})

	srv := &http.Server{
		Addr:              *bind,
		Handler:           h,
		ReadHeaderTimeout: 10 * time.Second,
	}

	if *certFile != "" && *keyFile != "" {
		log.Printf("[desktop] listening on %s (HTTPS), capture %dx%d@%dfps display=%q", *bind, *width, *height, *fps, *display)
		log.Fatal(srv.ListenAndServeTLS(*certFile, *keyFile))
	}
	log.Printf("[desktop] listening on %s (HTTP), capture %dx%d@%dfps display=%q", *bind, *width, *height, *fps, *display)
	log.Fatal(srv.ListenAndServe())
}
