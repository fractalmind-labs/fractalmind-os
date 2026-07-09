package desktop

import (
	"context"
	"os/exec"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"time"
)

// detectTimeout bounds each detection command. A background/SSH-launched service
// must never hang on startup — the macOS Finder AppleScript in particular can
// block on a TCC automation prompt that no one can answer. On timeout we fall
// back so the operator can still pass -width/-height explicitly.
const detectTimeout = 2 * time.Second

// runOut runs argv with a hard timeout, returning its stdout.
func runOut(argv ...string) (string, bool) {
	ctx, cancel := context.WithTimeout(context.Background(), detectTimeout)
	defer cancel()
	out, err := exec.CommandContext(ctx, argv[0], argv[1:]...).Output()
	if err != nil {
		return "", false
	}
	return string(out), true
}

// DetectDisplaySize returns the host's logical display size — the coordinate
// space the input injector operates in (X screen pixels for xdotool, points for
// cliclick). It lets a node map pointer coordinates without an operator passing
// -width/-height. Every probe is timeout-guarded so it can never hang startup;
// ok is false if detection fails, and the caller keeps its configured/default
// size. Explicit -width/-height always wins upstream and stays the reliable
// path on hosts where automation-based detection is unavailable.
func DetectDisplaySize() (w, h int, ok bool) {
	switch runtime.GOOS {
	case "darwin":
		// Finder desktop bounds give logical points, but need Automation (TCC)
		// permission and can hang headless — try it (guarded), then fall back to
		// system_profiler which needs no automation permission.
		if out, ok := runOut("osascript", "-e",
			`tell application "Finder" to get bounds of window of desktop`); ok {
			if w, h, ok := parseMacDesktopBounds(out); ok {
				return w, h, true
			}
		}
		if out, ok := runOut("system_profiler", "SPDisplaysDataType"); ok {
			return parseSystemProfiler(out)
		}
		return 0, 0, false
	default:
		if out, ok := runOut("xdotool", "getdisplaygeometry"); ok {
			return parseXdotoolGeometry(out)
		}
		return 0, 0, false
	}
}

var spResolutionRe = regexp.MustCompile(`Resolution:\s*(\d+)\s*x\s*(\d+)`)

// parseSystemProfiler pulls the first "Resolution: W x H" from
// `system_profiler SPDisplaysDataType`. It needs no automation permission.
func parseSystemProfiler(out string) (int, int, bool) {
	m := spResolutionRe.FindStringSubmatch(out)
	if m == nil {
		return 0, 0, false
	}
	w, _ := strconv.Atoi(m[1])
	h, _ := strconv.Atoi(m[2])
	if w <= 0 || h <= 0 {
		return 0, 0, false
	}
	return w, h, true
}

// parseXdotoolGeometry parses `xdotool getdisplaygeometry` output ("1920 1080").
func parseXdotoolGeometry(out string) (int, int, bool) {
	f := strings.Fields(strings.TrimSpace(out))
	if len(f) != 2 {
		return 0, 0, false
	}
	w, e1 := strconv.Atoi(f[0])
	h, e2 := strconv.Atoi(f[1])
	if e1 != nil || e2 != nil || w <= 0 || h <= 0 {
		return 0, 0, false
	}
	return w, h, true
}

var macBoundsRe = regexp.MustCompile(`-?\d+`)

// parseMacDesktopBounds parses AppleScript desktop bounds ("0, 0, 1920, 1080"),
// returning the width/height (the last two numbers minus the origin).
func parseMacDesktopBounds(out string) (int, int, bool) {
	nums := macBoundsRe.FindAllString(strings.TrimSpace(out), -1)
	if len(nums) != 4 {
		return 0, 0, false
	}
	x0, _ := strconv.Atoi(nums[0])
	y0, _ := strconv.Atoi(nums[1])
	x1, _ := strconv.Atoi(nums[2])
	y1, _ := strconv.Atoi(nums[3])
	w, h := x1-x0, y1-y0
	if w <= 0 || h <= 0 {
		return 0, 0, false
	}
	return w, h, true
}
