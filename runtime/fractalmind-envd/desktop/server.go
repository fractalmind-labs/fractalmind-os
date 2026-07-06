package desktop

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"sync"
	"time"

	"github.com/pion/webrtc/v4"
	"github.com/pion/webrtc/v4/pkg/media"
	"github.com/pion/webrtc/v4/pkg/media/h264reader"
)

// ServerConfig configures a desktop WebRTC session.
type ServerConfig struct {
	Capture    CaptureConfig
	ICEServers []webrtc.ICEServer
}

// Session is a single browser peer connection streaming the desktop and
// receiving input.
type Session struct {
	cfg      ServerConfig
	pc       *webrtc.PeerConnection
	track    *webrtc.TrackLocalStaticSample
	injector Injector
	capture  *Capture
	cancel   context.CancelFunc
	closed   chan struct{}
	once     sync.Once
}

// NewSession builds a peer connection with a single H.264 video track (sendonly)
// and an input data channel handler, applies the browser's SDP offer, and
// returns the local SDP answer to send back. Media begins flowing once ICE
// connects.
func NewSession(ctx context.Context, cfg ServerConfig, offer webrtc.SessionDescription) (*Session, *webrtc.SessionDescription, error) {
	me := &webrtc.MediaEngine{}
	if err := me.RegisterCodec(webrtc.RTPCodecParameters{
		RTPCodecCapability: webrtc.RTPCodecCapability{
			MimeType:    webrtc.MimeTypeH264,
			ClockRate:   90000,
			SDPFmtpLine: "level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f",
		},
		PayloadType: 102,
	}, webrtc.RTPCodecTypeVideo); err != nil {
		return nil, nil, fmt.Errorf("register codec: %w", err)
	}
	api := webrtc.NewAPI(webrtc.WithMediaEngine(me))

	pc, err := api.NewPeerConnection(webrtc.Configuration{ICEServers: cfg.ICEServers})
	if err != nil {
		return nil, nil, fmt.Errorf("new peer connection: %w", err)
	}

	track, err := webrtc.NewTrackLocalStaticSample(
		webrtc.RTPCodecCapability{MimeType: webrtc.MimeTypeH264},
		"video", "envd-desktop",
	)
	if err != nil {
		pc.Close()
		return nil, nil, fmt.Errorf("new track: %w", err)
	}
	if _, err := pc.AddTrack(track); err != nil {
		pc.Close()
		return nil, nil, fmt.Errorf("add track: %w", err)
	}

	sctx, cancel := context.WithCancel(ctx)
	s := &Session{
		cfg:      cfg,
		pc:       pc,
		track:    track,
		injector: NewInjector(cfg.Capture.Width, cfg.Capture.Height),
		cancel:   cancel,
		closed:   make(chan struct{}),
	}

	pc.OnDataChannel(func(dc *webrtc.DataChannel) {
		if dc.Label() != "input" {
			return
		}
		dc.OnMessage(func(msg webrtc.DataChannelMessage) {
			var ev Event
			if err := json.Unmarshal(msg.Data, &ev); err != nil {
				return
			}
			if err := s.injector.Handle(ev); err != nil {
				log.Printf("[desktop] inject error: %v", err)
			}
		})
	})

	pc.OnICEConnectionStateChange(func(state webrtc.ICEConnectionState) {
		log.Printf("[desktop] ICE state: %s", state)
		switch state {
		case webrtc.ICEConnectionStateConnected:
			s.startStreaming(sctx)
		case webrtc.ICEConnectionStateFailed, webrtc.ICEConnectionStateClosed, webrtc.ICEConnectionStateDisconnected:
			s.Close()
		}
	})

	if err := pc.SetRemoteDescription(offer); err != nil {
		s.Close()
		return nil, nil, fmt.Errorf("set remote description: %w", err)
	}
	answer, err := pc.CreateAnswer(nil)
	if err != nil {
		s.Close()
		return nil, nil, fmt.Errorf("create answer: %w", err)
	}
	gatherComplete := webrtc.GatheringCompletePromise(pc)
	if err := pc.SetLocalDescription(answer); err != nil {
		s.Close()
		return nil, nil, fmt.Errorf("set local description: %w", err)
	}
	// Non-trickle: wait for ICE gathering so the single answer carries all
	// candidates (simplest reliable path for a mobile browser client).
	select {
	case <-gatherComplete:
	case <-time.After(10 * time.Second):
	case <-sctx.Done():
	}

	local := pc.LocalDescription()
	return s, local, nil
}

// startStreaming launches capture and pumps H.264 access units into the track.
// It is idempotent per session.
func (s *Session) startStreaming(ctx context.Context) {
	s.once.Do(func() {
		go func() {
			cap, err := Start(ctx, s.cfg.Capture)
			if err != nil {
				log.Printf("[desktop] capture start failed: %v", err)
				s.Close()
				return
			}
			s.capture = cap
			defer cap.Stop()

			reader, err := h264reader.NewReader(cap.Stdout())
			if err != nil {
				log.Printf("[desktop] h264 reader: %v", err)
				s.Close()
				return
			}
			frameDur := time.Second / time.Duration(max(1, s.cfg.Capture.FPS))
			if s.cfg.Capture.FPS == 0 {
				frameDur = time.Second / 25
			}
			for {
				select {
				case <-ctx.Done():
					return
				case <-s.closed:
					return
				default:
				}
				nal, err := reader.NextNAL()
				if err != nil {
					log.Printf("[desktop] stream ended: %v", err)
					s.Close()
					return
				}
				if err := s.track.WriteSample(media.Sample{Data: nal.Data, Duration: frameDur}); err != nil {
					log.Printf("[desktop] write sample: %v", err)
					s.Close()
					return
				}
			}
		}()
	})
}

// Close tears down the session.
func (s *Session) Close() {
	s.cancel()
	select {
	case <-s.closed:
	default:
		close(s.closed)
	}
	if s.injector != nil {
		_ = s.injector.Close()
	}
	if s.pc != nil {
		_ = s.pc.Close()
	}
}

// Done returns a channel closed when the session ends.
func (s *Session) Done() <-chan struct{} { return s.closed }

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}
