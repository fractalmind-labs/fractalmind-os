package desktop

import (
	"context"
	"io"
	"sync"
	"testing"
	"time"

	"github.com/pion/webrtc/v4"
)

// TestConcurrentCloseNoPanic exercises the teardown path that is reachable from
// several goroutines at once (HTTP session-replace, ICE state callback, and the
// streaming goroutine). Before the sync.Once guard this panicked with
// "close of closed channel".
func TestConcurrentCloseNoPanic(t *testing.T) {
	pc, err := webrtc.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		t.Fatal(err)
	}
	_, cancel := context.WithCancel(context.Background())
	s := &Session{
		pc:       pc,
		injector: NewInjector(100, 100),
		cancel:   cancel,
		closed:   make(chan struct{}),
	}

	var wg sync.WaitGroup
	for i := 0; i < 32; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); s.Close() }()
	}
	wg.Wait()

	// Done channel must be closed exactly once and observable.
	select {
	case <-s.Done():
	default:
		t.Fatal("Done() channel not closed after Close()")
	}
	// A further Close must remain a no-op (no panic).
	s.Close()
}

func TestStreamingStatusRequiresWrittenFrame(t *testing.T) {
	old := startCapture
	defer func() { startCapture = old }()

	pr, pw := io.Pipe()
	startCapture = func(ctx context.Context, _ CaptureConfig) (captureProcess, error) {
		go func() {
			<-ctx.Done()
			_ = pw.Close()
		}()
		return pipeCapture{reader: pr, closer: pw}, nil
	}

	track, err := webrtc.NewTrackLocalStaticSample(
		webrtc.RTPCodecCapability{MimeType: webrtc.MimeTypeVP8},
		"video",
		"envd-desktop-test",
	)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	s := &Session{
		cfg:     ServerConfig{Capture: CaptureConfig{FPS: 25}},
		track:   track,
		cancel:  cancel,
		closed:  make(chan struct{}),
		status:  SessionStatus{Active: true},
		capture: nil,
	}
	s.startStreaming(ctx)
	t.Cleanup(func() {
		s.Close()
		_ = pr.Close()
		_ = pw.Close()
	})

	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		st := s.Status()
		if st.StartedAt != nil {
			if st.Streaming || st.FramesSent != 0 || st.LastFrameAt != nil {
				t.Fatalf("status before first frame = %+v, want not streaming with no frames", st)
			}
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("capture did not start")
}

type pipeCapture struct {
	reader io.Reader
	closer io.Closer
}

func (p pipeCapture) Stdout() io.Reader { return p.reader }

func (p pipeCapture) Stop() error {
	if p.closer == nil {
		return nil
	}
	return p.closer.Close()
}
