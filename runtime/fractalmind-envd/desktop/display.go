package desktop

import (
	"os/exec"
	"regexp"
	"runtime"
	"strconv"
	"strings"
)

// DetectDisplaySize returns the host's logical display size — the coordinate
// space the input injector operates in (X screen pixels for xdotool, points for
// cliclick). It lets a node map pointer coordinates correctly without an
// operator passing -width/-height, and keeps Retina/scaled displays accurate
// (macOS reports points, not backing pixels). ok is false if detection fails,
// in which case the caller keeps its configured/default size.
func DetectDisplaySize() (w, h int, ok bool) {
	switch runtime.GOOS {
	case "darwin":
		out, err := exec.Command("osascript", "-e",
			`tell application "Finder" to get bounds of window of desktop`).Output()
		if err != nil {
			return 0, 0, false
		}
		return parseMacDesktopBounds(string(out))
	default:
		out, err := exec.Command("xdotool", "getdisplaygeometry").Output()
		if err != nil {
			return 0, 0, false
		}
		return parseXdotoolGeometry(string(out))
	}
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
