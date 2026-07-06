//go:build smoke

package desktop

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/pion/webrtc/v4"
)

// TestNegotiationEndToEnd drives the real signaling + WebRTC negotiation with a
// headless pion client (stand-in for the browser): POST offer -> answer,
// ICE connect, ontrack, and input data-channel open. Run with:
//
//	go test -tags smoke -run TestNegotiationEndToEnd -v
func TestNegotiationEndToEnd(t *testing.T) {
	h := Handler(HTTPConfig{Server: ServerConfig{
		Capture: CaptureConfig{Width: 640, Height: 480, FPS: 15},
	}})
	srv := httptest.NewServer(h)
	defer srv.Close()

	client, err := webrtc.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()

	trackCh := make(chan struct{}, 1)
	client.OnTrack(func(*webrtc.TrackRemote, *webrtc.RTPReceiver) {
		select {
		case trackCh <- struct{}{}:
		default:
		}
	})
	if _, err := client.AddTransceiverFromKind(webrtc.RTPCodecTypeVideo,
		webrtc.RTPTransceiverInit{Direction: webrtc.RTPTransceiverDirectionRecvonly}); err != nil {
		t.Fatal(err)
	}
	dc, err := client.CreateDataChannel("input", nil)
	if err != nil {
		t.Fatal(err)
	}
	dcOpen := make(chan struct{}, 1)
	dc.OnOpen(func() { dcOpen <- struct{}{} })

	offer, err := client.CreateOffer(nil)
	if err != nil {
		t.Fatal(err)
	}
	gather := webrtc.GatheringCompletePromise(client)
	if err := client.SetLocalDescription(offer); err != nil {
		t.Fatal(err)
	}
	<-gather

	body, _ := json.Marshal(offerRequest{Offer: *client.LocalDescription()})
	resp, err := http.Post(srv.URL+"/offer", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 200 {
		t.Fatalf("offer status %d", resp.StatusCode)
	}
	var ar answerResponse
	if err := json.NewDecoder(resp.Body).Decode(&ar); err != nil {
		t.Fatal(err)
	}
	if ar.Answer.Type != webrtc.SDPTypeAnswer || ar.Answer.SDP == "" {
		t.Fatalf("bad answer: %+v", ar.Answer)
	}
	if err := client.SetRemoteDescription(ar.Answer); err != nil {
		t.Fatal(err)
	}

	select {
	case <-dcOpen:
		t.Log("input data channel open")
	case <-time.After(15 * time.Second):
		t.Fatal("data channel did not open (ICE/negotiation failed)")
	}

	// Exercise the input path immediately (the server tries to inject; may no-op
	// without a display, but the channel plumbing is what we validate here).
	// Sent right after open so a no-display capture EOF cannot race the teardown.
	if err := dc.SendText(`{"t":"move","x":0.5,"y":0.5}`); err != nil {
		t.Fatalf("send input: %v", err)
	}

	select {
	case <-trackCh:
		t.Log("remote video track received")
	case <-time.After(5 * time.Second):
		t.Log("ontrack not fired within window (expected if capture has no display); negotiation itself succeeded")
	}
}
