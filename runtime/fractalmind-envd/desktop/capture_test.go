package desktop

import (
	"strings"
	"testing"
)

func joined(args []string) string { return strings.Join(args, " ") }

func TestFFmpegArgsLinux(t *testing.T) {
	args := FFmpegArgs(CaptureConfig{Display: ":0", Width: 1280, Height: 720, FPS: 30, Bitrate: "3M"}, "linux")
	s := joined(args)
	for _, want := range []string{"-f x11grab", "-framerate 30", "-i :0", "-video_size 1280x720", "libx264", "-tune zerolatency", "-f h264", "-b:v 3M"} {
		if !strings.Contains(s, want) {
			t.Fatalf("linux args missing %q in: %s", want, s)
		}
	}
	if !strings.HasSuffix(s, " -") {
		t.Fatalf("stream should be emitted to stdout (-): %s", s)
	}
}

func TestFFmpegArgsDarwin(t *testing.T) {
	args := FFmpegArgs(CaptureConfig{Display: "1", FPS: 25}, "darwin")
	s := joined(args)
	for _, want := range []string{"-f avfoundation", "-i 1:none", "libx264", "-f h264"} {
		if !strings.Contains(s, want) {
			t.Fatalf("darwin args missing %q in: %s", want, s)
		}
	}
}

func TestFFmpegArgsDefaults(t *testing.T) {
	// Empty config picks per-OS defaults without panicking.
	lin := joined(FFmpegArgs(CaptureConfig{}, "linux"))
	if !strings.Contains(lin, "-i :0") || !strings.Contains(lin, "-framerate 25") {
		t.Fatalf("linux defaults wrong: %s", lin)
	}
	dar := joined(FFmpegArgs(CaptureConfig{}, "darwin"))
	if !strings.Contains(dar, "-i 1:none") {
		t.Fatalf("darwin default source wrong: %s", dar)
	}
}
