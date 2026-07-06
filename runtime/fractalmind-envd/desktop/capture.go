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

// defaultDisplay returns the platform default capture source for goos.
func defaultDisplay(goos string) string {
	if goos == "darwin" {
		return "1"
	}
	return ":0"
}

// FFmpegArgs builds the ffmpeg argument vector that grabs the screen and emits
// a low-latency Annex-B H.264 elementary stream on stdout. It is split from
// execution so the arguments can be unit-tested per platform.
func FFmpegArgs(cfg CaptureConfig, goos string) []string {
	cfg = cfg.withDefaults()
	if cfg.Display == "" {
		cfg.Display = defaultDisplay(goos)
	}
	args := []string{"-loglevel", "error"}

	switch goos {
	case "darwin":
		args = append(args, "-f", "avfoundation", "-framerate", strconv.Itoa(cfg.FPS))
		if cfg.Width > 0 && cfg.Height > 0 {
			args = append(args, "-video_size", fmt.Sprintf("%dx%d", cfg.Width, cfg.Height))
		}
		// avfoundation screen input is "<screen-index>:none" (no audio).
		args = append(args, "-i", cfg.Display+":none")
	default: // linux / x11
		args = append(args, "-f", "x11grab", "-framerate", strconv.Itoa(cfg.FPS))
		if cfg.Width > 0 && cfg.Height > 0 {
			args = append(args, "-video_size", fmt.Sprintf("%dx%d", cfg.Width, cfg.Height))
		}
		args = append(args, "-i", cfg.Display)
	}

	// Low-latency H.264 encode. baseline + no B-frames keeps decode simple for
	// mobile browsers; annexb + aud so the pion h264reader can frame NAL units.
	args = append(args,
		"-c:v", "libx264",
		"-preset", "ultrafast",
		"-tune", "zerolatency",
		"-profile:v", "baseline",
		"-pix_fmt", "yuv420p",
		"-g", strconv.Itoa(cfg.FPS*2),
		"-b:v", cfg.Bitrate,
		"-bf", "0",
		"-bsf:v", "h264_mp4toannexb",
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
