package desktop

import (
	"strings"
	"testing"
)

func joined(args []string) string { return strings.Join(args, " ") }

func TestFFmpegArgsLinux(t *testing.T) {
	args := FFmpegArgs(CaptureConfig{Display: ":0", Height: 720, FPS: 30, Bitrate: "3M"}, "linux")
	s := joined(args)
	for _, want := range []string{"-f x11grab", "-framerate 30", "-i :0", "format=yuv420p,scale=-2:720", "libvpx", "-deadline realtime", "-f ivf", "-b:v 3M"} {
		if !strings.Contains(s, want) {
			t.Fatalf("linux args missing %q in: %s", want, s)
		}
	}
	// The mismatched input -video_size must NOT be present (green-frame bug).
	if strings.Contains(s, "-video_size") {
		t.Fatalf("must not force input -video_size: %s", s)
	}
	// The redundant/​corrupting bitstream filter must be gone.
	if strings.Contains(s, "h264_mp4toannexb") {
		t.Fatalf("must not apply h264_mp4toannexb: %s", s)
	}
	if !strings.HasSuffix(s, " -") {
		t.Fatalf("stream should be emitted to stdout (-): %s", s)
	}
}

func TestFFmpegArgsDarwin(t *testing.T) {
	// A 1080p screen (Height set for input mapping) must still encode capped at
	// 720p to stay within baseline level 3.1. Pixel format is pinned to uyvy422.
	args := FFmpegArgs(CaptureConfig{Display: "0", Width: 1920, Height: 1080, FPS: 25, PixelFormat: "uyvy422"}, "darwin")
	s := joined(args)
	for _, want := range []string{"-f avfoundation", "-capture_cursor 1", "-pixel_format uyvy422", "-i 0:none", "format=yuv420p,scale=-2:720", "-vsync cfr", "libvpx", "-f ivf"} {
		if !strings.Contains(s, want) {
			t.Fatalf("darwin args missing %q in: %s", want, s)
		}
	}
	if strings.Contains(s, "-video_size") {
		t.Fatalf("avfoundation must capture native, not force -video_size: %s", s)
	}
	// Format conversion must precede scale (scaling packed uyvy422 greens the picture).
	if strings.Index(s, "format=yuv420p") > strings.Index(s, "scale=") {
		t.Fatalf("format=yuv420p must come before scale: %s", s)
	}
}

func TestFFmpegArgsDefaults(t *testing.T) {
	// Empty config picks per-OS defaults without panicking.
	lin := joined(FFmpegArgs(CaptureConfig{}, "linux"))
	if !strings.Contains(lin, "-i :0") || !strings.Contains(lin, "-framerate 25") {
		t.Fatalf("linux defaults wrong: %s", lin)
	}
	// Default darwin screen device is index 0 ("Capture screen 0"), not 1.
	dar := joined(FFmpegArgs(CaptureConfig{}, "darwin"))
	if !strings.Contains(dar, "-i 0:none") {
		t.Fatalf("darwin default source should be device 0: %s", dar)
	}
	// No size set → default 720p cap, format before scale.
	if !strings.Contains(dar, "format=yuv420p,scale=-2:720") {
		t.Fatalf("default should convert then cap height to 720: %s", dar)
	}
}
