package desktop

import (
	"reflect"
	"testing"
)

func linuxInjector(w, h int) *cmdInjector {
	return &cmdInjector{goos: "linux", width: w, height: h, run: runArgv}
}

func darwinInjector(w, h int) *cmdInjector {
	return &cmdInjector{goos: "darwin", width: w, height: h, run: runArgv}
}

func TestLinuxPointerMapping(t *testing.T) {
	in := linuxInjector(1920, 1080)
	got, ok := in.commands(Event{Type: "move", X: 0.5, Y: 0.5})
	if !ok {
		t.Fatal("move should map to a command")
	}
	want := [][]string{{"xdotool", "mousemove", "960", "540"}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}

func TestLinuxCoordsClampAndRightButton(t *testing.T) {
	in := linuxInjector(1000, 1000)
	// Out-of-range normalized coords clamp to the frame edges.
	got, _ := in.commands(Event{Type: "move", X: 1.5, Y: -0.2})
	want := [][]string{{"xdotool", "mousemove", "1000", "0"}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("clamp: got %v want %v", got, want)
	}
	// Right button -> X button 3.
	got, _ = in.commands(Event{Type: "down", Button: 2})
	if got[0][2] != "3" {
		t.Fatalf("right button: got %v", got)
	}
}

func TestLinuxScrollDirection(t *testing.T) {
	in := linuxInjector(800, 600)
	up, _ := in.commands(Event{Type: "scroll", DY: -3})
	down, _ := in.commands(Event{Type: "scroll", DY: 3})
	if up[0][2] != "4" || down[0][2] != "5" {
		t.Fatalf("scroll dirs wrong: up=%v down=%v", up, down)
	}
}

func TestLinuxKeyMapping(t *testing.T) {
	in := linuxInjector(1, 1)
	cases := map[string]string{
		"Enter":     "Return",
		"Backspace": "BackSpace",
		" ":         "space",
		"ArrowLeft": "Left",
		"a":         "a",
	}
	for key, sym := range cases {
		got, ok := in.commands(Event{Type: "key", Key: key, Down: true})
		if !ok {
			t.Fatalf("key %q should map", key)
		}
		if got[0][len(got[0])-1] != sym {
			t.Fatalf("key %q -> %v, want last arg %q", key, got[0], sym)
		}
	}
	// key-up is ignored on Linux (xdotool key is a full press).
	if _, ok := in.commands(Event{Type: "key", Key: "a", Down: false}); ok {
		t.Fatal("key-up should not map on Linux")
	}
	// Unknown multi-char key ignored.
	if _, ok := in.commands(Event{Type: "key", Key: "F13", Down: true}); ok {
		t.Fatal("unknown key should be ignored")
	}
}

func TestDarwinPointerAndKey(t *testing.T) {
	in := darwinInjector(1440, 900)
	got, ok := in.commands(Event{Type: "down", X: 0.25, Y: 0.5, Button: 0})
	if !ok || got[0][1] != "dd:360,450" {
		t.Fatalf("darwin down: got %v", got)
	}
	got, _ = in.commands(Event{Type: "down", X: 0, Y: 0, Button: 2})
	if got[0][1] != "rd:0,0" {
		t.Fatalf("darwin right-down: got %v", got)
	}
	got, ok = in.commands(Event{Type: "key", Key: "Enter", Down: true})
	if !ok || got[0][1] != "kp:return" {
		t.Fatalf("darwin key: got %v", got)
	}
}

func TestHandleRunsCommands(t *testing.T) {
	var ran [][]string
	in := &cmdInjector{goos: "linux", width: 100, height: 100, run: func(argv []string) error {
		ran = append(ran, argv)
		return nil
	}}
	if err := in.Handle(Event{Type: "move", X: 0.5, Y: 0.5}); err != nil {
		t.Fatalf("Handle: %v", err)
	}
	if len(ran) != 1 || ran[0][0] != "xdotool" {
		t.Fatalf("expected one xdotool call, got %v", ran)
	}
	// No-op event runs nothing.
	if err := in.Handle(Event{Type: "unknown"}); err != nil {
		t.Fatalf("Handle unknown: %v", err)
	}
	if len(ran) != 1 {
		t.Fatalf("unknown event should not run a command, ran=%v", ran)
	}
}

func TestLinuxTextAndCombo(t *testing.T) {
	in := linuxInjector(1, 1)

	got, ok := in.commands(Event{Type: "text", Text: "héllo"})
	if !ok || !reflect.DeepEqual(got, [][]string{{"xdotool", "type", "--clearmodifiers", "héllo"}}) {
		t.Fatalf("text: got %v ok=%v", got, ok)
	}

	got, ok = in.commands(Event{Type: "key", Down: true, Key: "c", Mods: []string{"ctrl"}})
	if !ok || !reflect.DeepEqual(got, [][]string{{"xdotool", "key", "--clearmodifiers", "ctrl+c"}}) {
		t.Fatalf("ctrl+c: got %v ok=%v", got, ok)
	}

	got, _ = in.commands(Event{Type: "key", Down: true, Key: "Delete", Mods: []string{"ctrl", "alt"}})
	if got[0][3] != "ctrl+alt+Delete" {
		t.Fatalf("ctrl+alt+del: got %v", got)
	}

	// cmd maps to super on Linux.
	got, _ = in.commands(Event{Type: "key", Down: true, Key: " ", Mods: []string{"cmd"}})
	if got[0][3] != "super+space" {
		t.Fatalf("super+space: got %v", got)
	}
}

func TestDarwinTextAndCombo(t *testing.T) {
	in := darwinInjector(1, 1)

	got, ok := in.commands(Event{Type: "text", Text: "hi 世界"})
	if !ok || !reflect.DeepEqual(got, [][]string{{"cliclick", "t:hi 世界"}}) {
		t.Fatalf("text: got %v ok=%v", got, ok)
	}

	got, ok = in.commands(Event{Type: "key", Down: true, Key: "c", Mods: []string{"cmd"}})
	if !ok || !reflect.DeepEqual(got, [][]string{{"cliclick", "kd:cmd", "t:c", "ku:cmd"}}) {
		t.Fatalf("cmd+c: got %v ok=%v", got, ok)
	}

	got, _ = in.commands(Event{Type: "key", Down: true, Key: " ", Mods: []string{"cmd"}})
	if !reflect.DeepEqual(got, [][]string{{"cliclick", "kd:cmd", "kp:space", "ku:cmd"}}) {
		t.Fatalf("cmd+space: got %v", got)
	}
}
