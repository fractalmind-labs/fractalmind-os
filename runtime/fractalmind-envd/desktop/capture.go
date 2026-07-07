// Package desktop implements a WebRTC remote-desktop server: it captures the
// host screen, encodes it to H.264 via ffmpeg, streams it to a browser over a
// pion WebRTC video track, and injects mouse/keyboard events received on a
// WebRTC data channel. It reuses the coordinator/relay SUI-identity plane for
// signaling authentication (see signaling auth in server.go).
package desktop

import (
	"context"
	"fmt"
	"io"
	"os/exec"
	"runtime"
	"strconv"
)

// CaptureConfig configures screen capture.
type CaptureConfig struct {
	// Display is the capture source. On Linux it is the X display (e.g. ":0"
	// or ":0.0+0,0"); on macOS it is the avfoundation screen index (e.g. "1").
	Display string
	// Width/Height are the capture dimensions; also used to map normalized
	// pointer coordinates to pixels for input injection. 0 = ffmpeg default.
	Width  int
	Height int
	// FPS is the capture frame rate.
	FPS int
	// Bitrate is the target H.264 bitrate, e.g. "4M".
	Bitrate string
	// FFmpegPath overrides the ffmpeg binary (default "ffmpeg").
	FFmpegPath string
}

func (c CaptureConfig) withDefaults() CaptureConfig {
	if c.FPS == 0 {
		c.FPS = 25
	}
	if c.Bitrate == "" {
		c.Bitrate = "4M"
	}
	if c.FFmpegPath == "" {
		c.FFmpegPath = "ffmpeg"
	}
	return c
}

// defaultDisplay returns the platform default capture source for goos. On macOS
// the avfoundation screen device is index 0 ("Capture screen 0"); on Linux it
// is X display ":0".
func defaultDisplay(goos string) string {
	if goos == "darwin" {
		return "0"
	}
	return ":0"
}

// FFmpegArgs builds the ffmpeg argument vector that grabs the screen and emits
// a low-latency Annex-B H.264 elementary stream on stdout. It is split from
// execution so the arguments can be unit-tested per platform.
//
// Sizing is done with a scale filter, NOT the input -video_size. On macOS,
// forcing avfoundation to a size other than the display's native resolution
// makes ffmpeg misread the raw capture buffer and emit corrupt (green) frames;
// x11grab on Linux would also rather capture the real geometry. So we always
// capture native and downscale in the filter graph when Width/Height are set.
func FFmpegArgs(cfg CaptureConfig, goos string) []string {
	cfg = cfg.withDefaults()
	if cfg.Display == "" {
		cfg.Display = defaultDisplay(goos)
	}
	args := []string{"-loglevel", "error"}

	switch goos {
	case "darwin":
		// Capture native (no -video_size); "<screen-index>:none" = video, no audio.
		args = append(args,
			"-f", "avfoundation",
			"-capture_cursor", "1",
			"-framerate", strconv.Itoa(cfg.FPS),
			"-i", cfg.Display+":none",
		)
	default: // linux / x11
		args = append(args, "-f", "x11grab", "-framerate", strconv.Itoa(cfg.FPS), "-i", cfg.Display)
	}

	// Downscale the encode to keep the stream within the advertised H.264 level
	// (baseline 3.1 → 720p). Width/Height describe the *real* screen (used for
	// input coordinate mapping), so the encode height is capped independently and
	// never upscales a smaller display. Aspect ratio is preserved (-2 = even
	// auto width), so the browser's normalized coordinates still map 1:1 onto the
	// real screen.
	encodeH := 720
	if cfg.Height > 0 && cfg.Height < encodeH {
		encodeH = cfg.Height
	}
	vf := fmt.Sprintf("scale=-2:%d:flags=bicubic,format=yuv420p", encodeH)

	// Low-latency H.264. Constrained baseline + no B-frames decodes on mobile
	// browsers; repeat-headers puts SPS/PPS before every keyframe so a client
	// joining mid-stream gets a decodable IDR (otherwise it renders green until
	// the next parameter sets arrive). No h264_mp4toannexb: libx264 -f h264 is
	// already Annex-B, and re-applying the mp4->annexb bitstream filter corrupts
	// the elementary stream.
	args = append(args,
		"-vf", vf,
		"-c:v", "libx264",
		"-preset", "ultrafast",
		"-tune", "zerolatency",
		"-profile:v", "baseline",
		"-level", "3.1",
		"-g", strconv.Itoa(cfg.FPS*2),
		"-keyint_min", strconv.Itoa(cfg.FPS),
		"-sc_threshold", "0",
		"-b:v", cfg.Bitrate,
		"-bf", "0",
		"-x264-params", "repeat-headers=1",
		"-f", "h264",
		"-",
	)
	return args
}

// Capture is a running ffmpeg screen-capture process.
type Capture struct {
	cmd    *exec.Cmd
	stdout io.ReadCloser
}

// Start launches ffmpeg and returns a Capture whose Stdout yields the H.264
// Annex-B stream. Call Stop to terminate.
func Start(ctx context.Context, cfg CaptureConfig) (*Capture, error) {
	cfg = cfg.withDefaults()
	if cfg.Display == "" {
		cfg.Display = defaultDisplay(runtime.GOOS)
	}
	cmd := exec.CommandContext(ctx, cfg.FFmpegPath, FFmpegArgs(cfg, runtime.GOOS)...)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, fmt.Errorf("ffmpeg stdout: %w", err)
	}
	cmd.Stderr = nil
	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("start ffmpeg: %w", err)
	}
	return &Capture{cmd: cmd, stdout: stdout}, nil
}

// Stdout returns the H.264 Annex-B stream.
func (c *Capture) Stdout() io.Reader { return c.stdout }

// Stop terminates the capture process.
func (c *Capture) Stop() error {
	if c.cmd == nil || c.cmd.Process == nil {
		return nil
	}
	_ = c.cmd.Process.Kill()
	_ = c.cmd.Wait()
	return nil
}
