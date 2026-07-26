package desktop

import (
	"bytes"
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"io"
	"os/exec"
	"testing"
	"time"

	"github.com/pion/webrtc/v4/pkg/media/ivfreader"
)

const (
	probeWidth  = 160
	probeHeight = 90
)

func TestSyntheticIVFCodecSanityDecodesNonBlackProgress(t *testing.T) {
	ffmpeg, err := exec.LookPath("ffmpeg")
	if err != nil {
		t.Skip("ffmpeg not available for decoded media-progress probe")
	}

	for generation := 1; generation <= 2; generation++ {
		stream := syntheticIVFStream(t, ffmpeg)
		frames := parseIVFFrames(t, stream)
		if len(frames) < 3 {
			t.Fatalf("generation %d IVF frames = %d, want at least 3", generation, len(frames))
		}
		if bytes.Equal(frames[0], frames[len(frames)-1]) {
			t.Fatalf("generation %d IVF frames are static", generation)
		}

		raw := decodeIVFToRGB(t, ffmpeg, stream)
		frameSize := probeWidth * probeHeight * 3
		if len(raw)%frameSize != 0 {
			t.Fatalf("generation %d decoded byte count = %d, not divisible by frame size %d", generation, len(raw), frameSize)
		}
		decodedFrames := len(raw) / frameSize
		if decodedFrames < 3 {
			t.Fatalf("generation %d decoded frames = %d, want at least 3", generation, decodedFrames)
		}
		first := raw[:frameSize]
		last := raw[(decodedFrames-1)*frameSize:]
		if isAllBlack(first) || isAllBlack(last) {
			t.Fatalf("generation %d decoded media is all black", generation)
		}
		if sha256.Sum256(first) == sha256.Sum256(last) {
			t.Fatalf("generation %d decoded media is static", generation)
		}
	}
}

func syntheticIVFStream(t *testing.T, ffmpeg string) []byte {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, ffmpeg,
		"-hide_banner",
		"-loglevel", "error",
		"-f", "lavfi",
		"-i", fmt.Sprintf("testsrc2=size=%dx%d:rate=5:duration=1", probeWidth, probeHeight),
		"-c:v", "libvpx",
		"-deadline", "realtime",
		"-cpu-used", "8",
		"-f", "ivf",
		"-",
	)
	out, err := cmd.Output()
	if err != nil {
		t.Fatalf("generate synthetic IVF: %v", err)
	}
	if len(out) == 0 {
		t.Fatal("generate synthetic IVF: empty output")
	}
	return out
}

func parseIVFFrames(t *testing.T, stream []byte) [][]byte {
	t.Helper()
	reader, _, err := ivfreader.NewWith(bytes.NewReader(stream))
	if err != nil {
		t.Fatalf("ivf reader: %v", err)
	}
	var frames [][]byte
	for {
		frame, _, err := reader.ParseNextFrame()
		if err != nil {
			if errors.Is(err, io.EOF) {
				break
			}
			t.Fatalf("parse IVF frame: %v", err)
		}
		frames = append(frames, append([]byte(nil), frame...))
	}
	return frames
}

func decodeIVFToRGB(t *testing.T, ffmpeg string, stream []byte) []byte {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, ffmpeg,
		"-hide_banner",
		"-loglevel", "error",
		"-i", "pipe:0",
		"-f", "rawvideo",
		"-pix_fmt", "rgb24",
		"pipe:1",
	)
	cmd.Stdin = bytes.NewReader(stream)
	out, err := cmd.Output()
	if err != nil {
		t.Fatalf("decode IVF to RGB: %v", err)
	}
	if len(out) == 0 {
		t.Fatal("decode IVF to RGB: empty output")
	}
	return out
}

func isAllBlack(frame []byte) bool {
	for _, v := range frame {
		if v > 8 {
			return false
		}
	}
	return true
}
