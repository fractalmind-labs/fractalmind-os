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
	"github.com/pion/webrtc/v4/pkg/media/ivfreader"
)

// ServerConfig configures a desktop WebRTC session.
type ServerConfig struct {
	Capture    CaptureConfig
	ICEServers []webrtc.ICEServer
}

// Session is a single browser peer connection streaming the desktop and
// receiving input.
type Session struct {
	cfg       ServerConfig
	pc        *webrtc.PeerConnection
	track     *webrtc.TrackLocalStaticSample
	injector  Injector
	capture   *Capture
	cancel    context.CancelFunc
	closed    chan struct{}
	once      sync.Once // guards startStreaming
	closeOnce sync.Once // guards teardown; Close is called from several goroutines
	statusMu  sync.RWMutex
	status    SessionStatus
}

type SessionStatus struct {
	Active        bool       `json:"active"`
	ICEState      string     `json:"ice_state"`
	Streaming     bool       `json:"streaming"`
	FramesSent    uint64     `json:"frames_sent"`
	BytesSent     uint64     `json:"bytes_sent"`
	ConnectedAt   *time.Time `json:"connected_at,omitempty"`
	StartedAt     *time.Time `json:"started_at,omitempty"`
	LastFrameAt   *time.Time `json:"last_frame_at,omitempty"`
	LastError     string     `json:"last_error,omitempty"`
	CaptureWidth  int        `json:"capture_width"`
	CaptureHeight int        `json:"capture_height"`
	EncodeHeight  int        `json:"encode_height"`
	FPS           int        `json:"fps"`
}

// NewSession builds a peer connection with a single VP8 video track (sendonly)
// and an input data channel handler, applies the browser's SDP offer, and
// returns the local SDP answer to send back. Media begins flowing once ICE
// connects. VP8 is used because browsers decode it in software, avoiding the
// macOS hardware H.264 decoder that renders our stream green.
func NewSession(ctx context.Context, cfg ServerConfig, offer webrtc.SessionDescription) (*Session, *webrtc.SessionDescription, error) {
	me := &webrtc.MediaEngine{}
	if err := me.RegisterCodec(webrtc.RTPCodecParameters{
		RTPCodecCapability: webrtc.RTPCodecCapability{
			MimeType:  webrtc.MimeTypeVP8,
			ClockRate: 90000,
		},
		PayloadType: 96,
	}, webrtc.RTPCodecTypeVideo); err != nil {
		return nil, nil, fmt.Errorf("register codec: %w", err)
	}
	api := webrtc.NewAPI(webrtc.WithMediaEngine(me))

	pc, err := api.NewPeerConnection(webrtc.Configuration{ICEServers: cfg.ICEServers})
	if err != nil {
		return nil, nil, fmt.Errorf("new peer connection: %w", err)
	}

	track, err := webrtc.NewTrackLocalStaticSample(
		webrtc.RTPCodecCapability{MimeType: webrtc.MimeTypeVP8},
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
	s.status = SessionStatus{
		Active:        true,
		ICEState:      "new",
		CaptureWidth:  cfg.Capture.Width,
		CaptureHeight: cfg.Capture.Height,
		EncodeHeight:  cfg.Capture.EncodeHeight,
		FPS:           cfg.Capture.FPS,
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
		s.updateStatus(func(st *SessionStatus) {
			st.ICEState = state.String()
			if state == webrtc.ICEConnectionStateConnected || state == webrtc.ICEConnectionStateCompleted {
				now := time.Now()
				st.ConnectedAt = &now
			}
		})
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
				s.setLastError("capture_start_failed: " + err.Error())
				s.Close()
				return
			}
			s.capture = cap
			s.updateStatus(func(st *SessionStatus) {
				now := time.Now()
				st.StartedAt = &now
				st.Streaming = true
				st.LastError = ""
			})
			defer cap.Stop()

			reader, _, err := ivfreader.NewWith(cap.Stdout())
			if err != nil {
				log.Printf("[desktop] ivf reader: %v", err)
				s.setLastError("ivf_reader: " + err.Error())
				s.Close()
				return
			}
			fps := s.cfg.Capture.FPS
			if fps <= 0 {
				fps = 25
			}
			frameDur := time.Second / time.Duration(fps)

			// VP8: each IVF frame is a self-contained picture, so we write one
			// sample per frame directly — no NAL/access-unit assembly needed.
			for {
				select {
				case <-ctx.Done():
					return
				case <-s.closed:
					return
				default:
				}
				frame, _, err := reader.ParseNextFrame()
				if err != nil {
					log.Printf("[desktop] stream ended: %v", err)
					s.setLastError("stream_ended: " + err.Error())
					s.Close()
					return
				}
				if err := s.track.WriteSample(media.Sample{Data: frame, Duration: frameDur}); err != nil {
					log.Printf("[desktop] write sample: %v", err)
					s.setLastError("write_sample: " + err.Error())
					s.Close()
					return
				}
				s.updateStatus(func(st *SessionStatus) {
					now := time.Now()
					st.FramesSent++
					st.BytesSent += uint64(len(frame))
					st.LastFrameAt = &now
				})
			}
		}()
	})
}

// Close tears down the session. It is safe to call concurrently and more than
// once — Close is invoked from the HTTP session-replace path, the ICE state
// callback, and the streaming goroutine, which can overlap.
func (s *Session) Close() {
	s.closeOnce.Do(func() {
		s.updateStatus(func(st *SessionStatus) {
			st.Active = false
			st.Streaming = false
		})
		s.cancel()
		close(s.closed)
		if s.injector != nil {
			_ = s.injector.Close()
		}
		if s.pc != nil {
			_ = s.pc.Close()
		}
	})
}

// Done returns a channel closed when the session ends.
func (s *Session) Done() <-chan struct{} { return s.closed }

func (s *Session) Status() SessionStatus {
	s.statusMu.RLock()
	defer s.statusMu.RUnlock()
	return s.status
}

func (s *Session) updateStatus(fn func(*SessionStatus)) {
	s.statusMu.Lock()
	defer s.statusMu.Unlock()
	fn(&s.status)
}

func (s *Session) setLastError(msg string) {
	s.updateStatus(func(st *SessionStatus) {
		st.LastError = msg
		st.Streaming = false
	})
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}
