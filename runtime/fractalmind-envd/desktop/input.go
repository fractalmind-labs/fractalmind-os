package desktop

import (
	"fmt"
	"math"
	"runtime"
	"strconv"
)

// Event is a pointer/keyboard event from the browser client. Pointer
// coordinates X/Y are normalized to [0,1] relative to the streamed frame so the
// client does not need to know the host resolution.
type Event struct {
	Type   string  `json:"t"`              // "move","down","up","key","scroll"
	X      float64 `json:"x,omitempty"`    // normalized 0..1
	Y      float64 `json:"y,omitempty"`    // normalized 0..1
	Button int     `json:"b,omitempty"`    // 0=left,1=middle,2=right
	Key    string  `json:"k,omitempty"`    // browser KeyboardEvent.key
	Down   bool    `json:"down,omitempty"` // for "key": press vs release
	DY     float64 `json:"dy,omitempty"`   // scroll delta
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
	case "scroll":
		btn := 4 // wheel up
		if ev.DY > 0 {
			btn = 5 // wheel down
		}
		return [][]string{{"xdotool", "click", strconv.Itoa(btn)}}, true
	case "key":
		if !ev.Down {
			return nil, false // xdotool key is a full press; ignore key-up
		}
		sym := xdotoolKeysym(ev.Key)
		if sym == "" {
			return nil, false
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
	case "key":
		if !ev.Down {
			return nil, false
		}
		if kp := cliclickKey(ev.Key); kp != "" {
			return [][]string{{"cliclick", kp}}, true
		}
		return nil, false
	}
	return nil, false
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

// xdotoolKeysym maps a browser KeyboardEvent.key to an X keysym name.
func xdotoolKeysym(key string) string {
	switch key {
	case "":
		return ""
	case "Enter":
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
	case "Enter":
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
