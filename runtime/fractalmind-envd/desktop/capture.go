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
	// Bitrate is the target VP8 bitrate, e.g. "4M".
	Bitrate string
	// EncodeHeight is the encoded video height. The native screen is still
	// captured and pointer mapping still uses Width/Height; this only controls
	// the outgoing stream resolution. 0 = default 720p.
	EncodeHeight int
	// FFmpegPath overrides the ffmpeg binary (default "ffmpeg").
	FFmpegPath string
	// PixelFormat, when set, pins the capture-input pixel format (e.g. macOS
	// avfoundation screen capture is typically "uyvy422"). Passed as ffmpeg
	// -pixel_format before -i so the decoder does not misread the raw buffer.
	PixelFormat string
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
// a low-latency VP8/IVF stream on stdout. It is split from execution so the
// arguments can be unit-tested per platform.
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
		args = append(args, "-f", "avfoundation", "-capture_cursor", "1", "-framerate", strconv.Itoa(cfg.FPS))
		// avfoundation screen capture delivers packed uyvy422; pinning the input
		// pixel format stops ffmpeg misreading the raw buffer (a cause of green
		// frames). It also reports a bogus ~1000k-fps timebase, so we normalize
		// the output rate below.
		if cfg.PixelFormat != "" {
			args = append(args, "-pixel_format", cfg.PixelFormat)
		}
		args = append(args, "-i", cfg.Display+":none")
	default: // linux / x11
		if cfg.PixelFormat != "" {
			args = append(args, "-pixel_format", cfg.PixelFormat)
		}
		args = append(args, "-f", "x11grab", "-framerate", strconv.Itoa(cfg.FPS), "-i", cfg.Display)
	}

	// Convert to planar yuv420p FIRST (before scaling), then downscale. Scaling a
	// packed 4:2:2 buffer before the pixel-format conversion is what turns the
	// picture green on the avfoundation path; converting first is safe for any
	// input. Encode height is configurable; Width/Height describe the *real*
	// screen (used only for input coordinate mapping), and we never upscale a
	// smaller source.
	// Aspect ratio is preserved (-2 = even auto width), so normalized pointer
	// coordinates still map 1:1 onto the real screen.
	encodeH := cfg.EncodeHeight
	if encodeH <= 0 {
		encodeH = 720
	}
	if cfg.Height > 0 && cfg.Height < encodeH {
		encodeH = cfg.Height
	}
	vf := fmt.Sprintf("format=yuv420p,scale=-2:%d", encodeH)

	// Low-latency VP8 in an IVF stream. VP8 is used instead of H.264 because
	// browsers decode it in software (WebRTC baseline), avoiding the macOS
	// VideoToolbox hardware H.264 decoder that renders our libx264 stream green
	// even though it decodes cleanly in software. VP8 frames are self-contained
	// (one IVF frame per picture), so there is no NAL/access-unit assembly. -r +
	// cfr normalize the bogus avfoundation timebase; error-resilient + no alt-ref
	// keep a client that joins mid-stream decodable.
	args = append(args,
		"-vf", vf,
		"-r", strconv.Itoa(cfg.FPS),
		"-vsync", "cfr",
		"-c:v", "libvpx",
		"-deadline", "realtime",
		"-cpu-used", "8",
		"-b:v", cfg.Bitrate,
		"-g", strconv.Itoa(cfg.FPS*2),
		"-keyint_min", strconv.Itoa(cfg.FPS),
		"-auto-alt-ref", "0",
		"-lag-in-frames", "0",
		"-error-resilient", "1",
		"-f", "ivf",
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
