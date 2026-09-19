package desktop

import (
	"fmt"
	"math"
	"runtime"
	"strconv"
	"strings"
)

// Event is a pointer/keyboard event from the browser client. Pointer
// coordinates X/Y are normalized to [0,1] relative to the streamed frame so the
// client does not need to know the host resolution.
type Event struct {
	Type   string   `json:"t"`              // "move","down","up","click","key","text","scroll"
	X      float64  `json:"x,omitempty"`    // normalized 0..1
	Y      float64  `json:"y,omitempty"`    // normalized 0..1
	Button int      `json:"b,omitempty"`    // 0=left,1=middle,2=right
	Count  int      `json:"c,omitempty"`    // for "click": 1=single,2=double
	Key    string   `json:"k,omitempty"`    // browser KeyboardEvent.key
	Down   bool     `json:"down,omitempty"` // for "key": press vs release
	DY     float64  `json:"dy,omitempty"`   // scroll delta
	Text   string   `json:"text,omitempty"` // for "text": literal string to type (IME-friendly)
	Mods   []string `json:"mods,omitempty"` // for "key": held modifiers (ctrl/alt/shift/cmd)
}

// Injector applies input events on the host.
type Injector interface {
	Handle(ev Event) error
	// Close releases resources.
	Close() error
}

// cmdInjector executes external tools (xdotool / cliclick) to inject input. The
// run hook is injected so command construction can be unit-tested without
// touching the host.
type cmdInjector struct {
	goos   string
	width  int
	height int
	run    func(argv []string) error
}

// NewInjector returns a host Injector sized to width x height (the capture
// dimensions), using xdotool on Linux and cliclick on macOS.
func NewInjector(width, height int) Injector {
	return &cmdInjector{
		goos:   runtime.GOOS,
		width:  width,
		height: height,
		run:    runArgv,
	}
}

func (in *cmdInjector) px(x, y float64) (int, int) {
	clamp := func(v float64) float64 { return math.Max(0, math.Min(1, v)) }
	return int(clamp(x) * float64(in.width)), int(clamp(y) * float64(in.height))
}

// commands returns the external command(s) to run for an event, or (nil,false)
// if the event maps to nothing. Pure and unit-tested.
func (in *cmdInjector) commands(ev Event) ([][]string, bool) {
	switch in.goos {
	case "darwin":
		return in.darwinCommands(ev)
	default:
		return in.linuxCommands(ev)
	}
}

func (in *cmdInjector) linuxCommands(ev Event) ([][]string, bool) {
	switch ev.Type {
	case "move":
		x, y := in.px(ev.X, ev.Y)
		return [][]string{{"xdotool", "mousemove", strconv.Itoa(x), strconv.Itoa(y)}}, true
	case "down":
		return [][]string{{"xdotool", "mousedown", strconv.Itoa(xdotoolButton(ev.Button))}}, true
	case "up":
		return [][]string{{"xdotool", "mouseup", strconv.Itoa(xdotoolButton(ev.Button))}}, true
	case "click":
		count, ok := clickCount(ev)
		if !ok {
			return nil, false
		}
		x, y := in.px(ev.X, ev.Y)
		button := strconv.Itoa(xdotoolButton(ev.Button))
		if count == 2 {
			return [][]string{{
				"xdotool", "mousemove", strconv.Itoa(x), strconv.Itoa(y),
				"click", "--repeat", "2", "--delay", "200", button,
			}}, true
		}
		return [][]string{{
			"xdotool", "mousemove", strconv.Itoa(x), strconv.Itoa(y), "click", button,
		}}, true
	case "scroll":
		btn := 4 // wheel up
		if ev.DY > 0 {
			btn = 5 // wheel down
		}
		return [][]string{{"xdotool", "click", strconv.Itoa(btn)}}, true
	case "text":
		if ev.Text == "" {
			return nil, false
		}
		return [][]string{{"xdotool", "type", "--clearmodifiers", ev.Text}}, true
	case "key":
		if !ev.Down {
			return nil, false // xdotool key is a full press; ignore key-up
		}
		sym := xdotoolKeysym(ev.Key)
		if sym == "" {
			return nil, false
		}
		// With modifiers, xdotool takes a "ctrl+alt+Delete"-style chord.
		if mods := xdotoolMods(ev.Mods); len(mods) > 0 {
			return [][]string{{"xdotool", "key", "--clearmodifiers", strings.Join(append(mods, sym), "+")}}, true
		}
		return [][]string{{"xdotool", "key", "--clearmodifiers", sym}}, true
	}
	return nil, false
}

func (in *cmdInjector) darwinCommands(ev Event) ([][]string, bool) {
	switch ev.Type {
	case "move":
		x, y := in.px(ev.X, ev.Y)
		return [][]string{{"cliclick", fmt.Sprintf("m:%d,%d", x, y)}}, true
	case "down":
		x, y := in.px(ev.X, ev.Y)
		verb := "dd"
		if ev.Button == 2 {
			verb = "rd"
		}
		return [][]string{{"cliclick", fmt.Sprintf("%s:%d,%d", verb, x, y)}}, true
	case "up":
		x, y := in.px(ev.X, ev.Y)
		verb := "du"
		if ev.Button == 2 {
			verb = "ru"
		}
		return [][]string{{"cliclick", fmt.Sprintf("%s:%d,%d", verb, x, y)}}, true
	case "click":
		count, ok := clickCount(ev)
		if !ok {
			return nil, false
		}
		x, y := in.px(ev.X, ev.Y)
		verb := "c"
		if ev.Button == 2 {
			verb = "rc"
		} else if count == 2 {
			verb = "dc"
		}
		return [][]string{{"cliclick", fmt.Sprintf("%s:%d,%d", verb, x, y)}}, true
	case "scroll":
		return [][]string{{"cliclick", fmt.Sprintf("w:0,%d", scrollClicks(ev.DY))}}, true
	case "text":
		if ev.Text == "" {
			return nil, false
		}
		return [][]string{{"cliclick", "t:" + ev.Text}}, true
	case "key":
		if !ev.Down {
			return nil, false
		}
		if code, ok := darwinKeyCode(ev.Key); ok {
			return [][]string{osascriptKeyCode(code, ev.Mods)}, true
		}
		kp := cliclickKey(ev.Key)
		if kp == "" {
			return nil, false
		}
		if mods := cliclickMods(ev.Mods); mods != "" {
			// A single printable char with modifiers (Cmd+C, Ctrl+A, ...) must be
			// a real modified keystroke. cliclick's t: types unicode text and
			// ignores held modifier flags, so it would insert a literal char;
			// use AppleScript keystroke, which honors the modifier set. Named
			// keys (kp:arrow-up, kp:space, ...) are real key presses that do
			// combine with cliclick's kd:/ku:.
			if strings.HasPrefix(kp, "t:") {
				return [][]string{osascriptKeystroke(strings.TrimPrefix(kp, "t:"), ev.Mods)}, true
			}
			return [][]string{{"cliclick", "kd:" + mods, kp, "ku:" + mods}}, true
		}
		return [][]string{{"cliclick", kp}}, true
	}
	return nil, false
}

// osascriptKeyCode builds an AppleScript key-code press. Some special keys are
// not reliable through cliclick kp:* on macOS login/password fields; Backspace in
// particular must be the physical Delete key (key code 51), not forward delete.
func osascriptKeyCode(code int, mods []string) []string {
	parts := make([]string, 0, len(mods))
	for _, m := range mods {
		switch strings.ToLower(m) {
		case "cmd", "meta", "super", "win":
			parts = append(parts, "command down")
		case "ctrl", "control":
			parts = append(parts, "control down")
		case "alt", "option":
			parts = append(parts, "option down")
		case "shift":
			parts = append(parts, "shift down")
		}
	}
	script := fmt.Sprintf(`tell application "System Events" to key code %d`, code)
	if len(parts) > 0 {
		script += fmt.Sprintf(` using {%s}`, strings.Join(parts, ", "))
	}
	return []string{"osascript", "-e", script}
}

func darwinKeyCode(key string) (int, bool) {
	switch key {
	case "Enter", "Return", "NumpadEnter":
		return 36, true // Return
	case "Tab":
		return 48, true
	case "Escape":
		return 53, true
	case " ", "Spacebar":
		return 49, true
	case "Backspace":
		return 51, true // physical Delete / backspace key
	case "Delete":
		return 117, true // forward delete
	case "Home":
		return 115, true
	case "End":
		return 119, true
	case "PageUp":
		return 116, true
	case "PageDown":
		return 121, true
	case "ArrowLeft":
		return 123, true
	case "ArrowRight":
		return 124, true
	case "ArrowDown":
		return 125, true
	case "ArrowUp":
		return 126, true
	}
	return 0, false
}

// osascriptKeystroke builds an AppleScript that presses a printable key with
// modifiers held (e.g. Cmd+C), the reliable macOS primitive for modified
// keystrokes.
func osascriptKeystroke(char string, mods []string) []string {
	parts := make([]string, 0, len(mods))
	for _, m := range mods {
		switch strings.ToLower(m) {
		case "cmd", "meta", "super", "win":
			parts = append(parts, "command down")
		case "ctrl", "control":
			parts = append(parts, "control down")
		case "alt", "option":
			parts = append(parts, "option down")
		case "shift":
			parts = append(parts, "shift down")
		}
	}
	// AppleScript string literal: escape backslash and quote.
	esc := strings.NewReplacer(`\`, `\\`, `"`, `\"`).Replace(char)
	script := fmt.Sprintf(`tell application "System Events" to keystroke "%s" using {%s}`,
		esc, strings.Join(parts, ", "))
	return []string{"osascript", "-e", script}
}

// Handle applies an event on the host.
func (in *cmdInjector) Handle(ev Event) error {
	cmds, ok := in.commands(ev)
	if !ok {
		return nil
	}
	for _, argv := range cmds {
		if err := in.run(argv); err != nil {
			return fmt.Errorf("inject %s: %w", ev.Type, err)
		}
	}
	return nil
}

func (in *cmdInjector) Close() error { return nil }

func scrollClicks(dy float64) int {
	if dy < 0 {
		return 1
	}
	return -1
}

func clickCount(ev Event) (int, bool) {
	if ev.Button != 0 && ev.Button != 2 {
		return 0, false
	}
	if ev.Count != 1 && !(ev.Count == 2 && ev.Button == 0) {
		return 0, false
	}
	return ev.Count, true
}

func xdotoolButton(b int) int {
	switch b {
	case 1:
		return 2 // middle
	case 2:
		return 3 // right
	default:
		return 1 // left
	}
}

// xdotoolMods maps client modifier names to xdotool chord tokens.
func xdotoolMods(mods []string) []string {
	out := make([]string, 0, len(mods))
	for _, m := range mods {
		switch strings.ToLower(m) {
		case "ctrl", "control":
			out = append(out, "ctrl")
		case "alt", "option":
			out = append(out, "alt")
		case "shift":
			out = append(out, "shift")
		case "cmd", "meta", "super", "win":
			out = append(out, "super")
		}
	}
	return out
}

// cliclickMods maps client modifier names to a cliclick kd:/ku: value.
func cliclickMods(mods []string) string {
	out := make([]string, 0, len(mods))
	for _, m := range mods {
		switch strings.ToLower(m) {
		case "ctrl", "control":
			out = append(out, "ctrl")
		case "alt", "option":
			out = append(out, "alt")
		case "shift":
			out = append(out, "shift")
		case "cmd", "meta", "super", "win":
			out = append(out, "cmd")
		}
	}
	return strings.Join(out, ",")
}

// xdotoolKeysym maps a browser KeyboardEvent.key to an X keysym name.
func xdotoolKeysym(key string) string {
	switch key {
	case "":
		return ""
	case "Enter", "Return", "NumpadEnter":
		return "Return"
	case "Backspace":
		return "BackSpace"
	case "Tab":
		return "Tab"
	case "Escape":
		return "Escape"
	case " ", "Spacebar":
		return "space"
	case "ArrowUp":
		return "Up"
	case "ArrowDown":
		return "Down"
	case "ArrowLeft":
		return "Left"
	case "ArrowRight":
		return "Right"
	case "Delete":
		return "Delete"
	case "Home":
		return "Home"
	case "End":
		return "End"
	}
	// Single printable character: xdotool accepts the literal for `key`.
	if len([]rune(key)) == 1 {
		return key
	}
	return ""
}

// cliclickKey maps a browser key to a cliclick key spec (best-effort).
func cliclickKey(key string) string {
	switch key {
	case "":
		return ""
	case "Enter", "Return", "NumpadEnter":
		return "kp:return"
	case "Backspace":
		return "kp:delete"
	case "Tab":
		return "kp:tab"
	case "Escape":
		return "kp:esc"
	case " ", "Spacebar":
		return "kp:space"
	case "ArrowUp":
		return "kp:arrow-up"
	case "ArrowDown":
		return "kp:arrow-down"
	case "ArrowLeft":
		return "kp:arrow-left"
	case "ArrowRight":
		return "kp:arrow-right"
	}
	if len([]rune(key)) == 1 {
		return "t:" + key
	}
	return ""
}
