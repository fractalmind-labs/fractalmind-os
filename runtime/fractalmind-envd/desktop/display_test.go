package desktop

import "testing"

func TestParseXdotoolGeometry(t *testing.T) {
	cases := []struct {
		in     string
		w, h   int
		wantOK bool
	}{
		{"1920 1080\n", 1920, 1080, true},
		{"  2560 1440 ", 2560, 1440, true},
		{"1920", 0, 0, false},
		{"abc def", 0, 0, false},
		{"0 1080", 0, 0, false},
		{"", 0, 0, false},
	}
	for _, c := range cases {
		w, h, ok := parseXdotoolGeometry(c.in)
		if ok != c.wantOK || (ok && (w != c.w || h != c.h)) {
			t.Errorf("parseXdotoolGeometry(%q) = %d,%d,%v want %d,%d,%v", c.in, w, h, ok, c.w, c.h, c.wantOK)
		}
	}
}

func TestParseMacDesktopBounds(t *testing.T) {
	cases := []struct {
		in     string
		w, h   int
		wantOK bool
	}{
		{"0, 0, 1920, 1080\n", 1920, 1080, true},
		{"0, 0, 1440, 900", 1440, 900, true},
		// non-zero origin (secondary display arrangement)
		{"100, 50, 1620, 1130", 1520, 1080, true},
		{"0, 0, 1920", 0, 0, false},
		{"garbage", 0, 0, false},
		{"0, 0, 0, 0", 0, 0, false},
	}
	for _, c := range cases {
		w, h, ok := parseMacDesktopBounds(c.in)
		if ok != c.wantOK || (ok && (w != c.w || h != c.h)) {
			t.Errorf("parseMacDesktopBounds(%q) = %d,%d,%v want %d,%d,%v", c.in, w, h, ok, c.w, c.h, c.wantOK)
		}
	}
}

func TestParseSystemProfiler(t *testing.T) {
	out := `Graphics/Displays:
    Apple M2:
      Displays:
        Color LCD:
          Resolution: 1920 x 1080
          Main Display: Yes`
	w, h, ok := parseSystemProfiler(out)
	if !ok || w != 1920 || h != 1080 {
		t.Fatalf("got %d,%d,%v want 1920,1080,true", w, h, ok)
	}
	if _, _, ok := parseSystemProfiler("no resolution here"); ok {
		t.Fatal("expected no match")
	}
}
