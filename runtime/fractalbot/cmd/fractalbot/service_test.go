package main

import (
	"bytes"
	"encoding/xml"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestServiceDefinitions(t *testing.T) {
	s := serviceSpec{GOOS: "darwin", Home: "/Users/me", Executable: "/Users/me/bin/fractal bot", ConfigPath: "/Users/me/.config/fractalbot/config.yaml", LogDir: "/Users/me/data/logs", Path: "/opt/homebrew/bin:/usr/bin"}
	plist := s.definition()
	if err := xml.Unmarshal([]byte(plist), new(struct{})); err != nil {
		t.Fatalf("plist is not XML: %v", err)
	}
	if !strings.Contains(plist, "<string>/Users/me/bin/fractal bot</string>") || !strings.Contains(plist, "/Users/me/data/logs/fractalbot.log") || !strings.Contains(plist, "<string>/opt/homebrew/bin:/usr/bin</string>") {
		t.Fatalf("plist: %s", plist)
	}
	if s.definitionPath() != "/Users/me/Library/LaunchAgents/ai.fractalmind.fractalbot.plist" {
		t.Fatalf("path: %s", s.definitionPath())
	}
	s.GOOS = "linux"
	if unit := s.definition(); !strings.Contains(unit, `ExecStart="/Users/me/bin/fractal bot" --config "/Users/me/.config/fractalbot/config.yaml"`) || !strings.Contains(unit, "Restart=always") {
		t.Fatalf("unit: %s", unit)
	}
	for _, def := range []string{plist, s.definition()} {
		if strings.Contains(strings.ToLower(def), "token") || strings.Contains(strings.ToLower(def), "proxy") {
			t.Fatal("service definitions must not carry secrets or proxy settings")
		}
	}
}

func TestServiceInstallAndRestartCommands(t *testing.T) {
	var calls []string
	orig, origSleep := serviceRunner, serviceSleep
	t.Cleanup(func() { serviceRunner, serviceSleep = orig, origSleep })
	serviceSleep = func(time.Duration) {}
	serviceRunner = func(name string, args ...string) (string, error) {
		calls = append(calls, name+" "+strings.Join(args, " "))
		return "", nil
	}
	home := t.TempDir()
	s := serviceSpec{GOOS: "linux", Home: home, Executable: "/bin/fractalbot", ConfigPath: "/c.yaml", LogDir: filepath.Join(home, "logs")}
	var out bytes.Buffer
	if err := installService(s, &out); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(home, ".config/systemd/user/fractalbot.service")); err != nil {
		t.Fatalf("unit not written: %v", err)
	}
	if err := restartService(s, &out); err != nil {
		t.Fatal(err)
	}
	if err := uninstallService(s, &out); err != nil {
		t.Fatal(err)
	}
	got := strings.Join(calls, "\n")
	for _, want := range []string{"systemctl --user enable --now fractalbot.service", "systemctl --user restart fractalbot.service", "systemctl --user disable --now fractalbot.service"} {
		if !strings.Contains(got, want) {
			t.Fatalf("missing %q in:\n%s", want, got)
		}
	}
	s.GOOS = "windows"
	calls = nil
	if err := installService(s, &out); err != nil || !strings.Contains(strings.Join(calls, "\n"), "schtasks /Create /F /SC ONLOGON") {
		t.Fatalf("windows: %v %v", err, calls)
	}
}

func TestServiceInstallRetriesBootstrapOnMacOS(t *testing.T) {
	orig, origSleep := serviceRunner, serviceSleep
	t.Cleanup(func() { serviceRunner, serviceSleep = orig, origSleep })
	serviceSleep = func(time.Duration) {}
	bootstraps := 0
	serviceRunner = func(name string, args ...string) (string, error) {
		if len(args) > 0 && args[0] == "bootstrap" {
			bootstraps++
			if bootstraps < 3 {
				return "Bootstrap failed: 5: Input/output error", errors.New("exit status 5")
			}
		}
		return "", nil
	}
	home := t.TempDir()
	s := serviceSpec{GOOS: "darwin", Home: home, Executable: "/bin/fractalbot", ConfigPath: "/c.yaml", LogDir: filepath.Join(home, "logs")}
	if err := installService(s, &bytes.Buffer{}); err != nil || bootstraps != 3 {
		t.Fatalf("err=%v bootstraps=%d", err, bootstraps)
	}
}
