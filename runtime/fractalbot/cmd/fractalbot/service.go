package main

import (
	"errors"
	"fmt"
	"html"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"

	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalbot/internal/configv2"
)

const (
	serviceLabel   = "ai.fractalmind.fractalbot"
	serviceUnit    = "fractalbot.service"
	serviceTask    = "FractalBot"
	serviceLogFile = "fractalbot.log"
)

// serviceSleep waits between service manager retries; tests replace it.
var serviceSleep = time.Sleep

// serviceRunner runs service manager commands; tests replace it.
var serviceRunner = func(name string, args ...string) (string, error) {
	out, err := exec.Command(name, args...).CombinedOutput()
	return strings.TrimSpace(string(out)), err
}

// serviceSpec is what a service definition starts.
type serviceSpec struct {
	GOOS       string
	Home       string
	Executable string
	ConfigPath string
	LogDir     string
	// Path is the PATH the gateway runs with, so runtimes find python3,
	// tmux, codex and imsg as they do in the installing shell.
	Path string
}

// definitionPath is where the current user's service definition lives.
func (s serviceSpec) definitionPath() string {
	switch s.GOOS {
	case "darwin":
		return filepath.Join(s.Home, "Library", "LaunchAgents", serviceLabel+".plist")
	case "linux":
		return filepath.Join(s.Home, ".config", "systemd", "user", serviceUnit)
	}
	return ""
}

// definition renders the service definition. It holds no secrets and no
// proxy settings: the gateway reads both itself.
func (s serviceSpec) definition() string {
	switch s.GOOS {
	case "darwin":
		x := html.EscapeString
		log := filepath.Join(s.LogDir, serviceLogFile)
		return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>` + serviceLabel + `</string>
  <key>ProgramArguments</key>
  <array>
    <string>` + x(s.Executable) + `</string>
    <string>--config</string>
    <string>` + x(s.ConfigPath) + `</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>` + x(s.Path) + `</string>
  </dict>
  <key>ProcessType</key><string>Background</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>` + x(log) + `</string>
  <key>StandardErrorPath</key><string>` + x(log) + `</string>
</dict>
</plist>
`
	case "linux":
		return `[Unit]
Description=FractalBot gateway
After=network-online.target

[Service]
Environment=` + strconv.Quote("PATH="+s.Path) + `
ExecStart=` + strconv.Quote(s.Executable) + ` --config ` + strconv.Quote(s.ConfigPath) + `
Restart=always
RestartSec=10

[Install]
WantedBy=default.target
`
	}
	return ""
}

func runServiceCommand(cfg *configv2.Config, args []string, out io.Writer) int {
	if len(args) == 0 {
		fmt.Fprintln(out, "usage: fractalbot service install | uninstall | status | restart")
		return 1
	}
	exe, err := os.Executable()
	if err == nil {
		exe, err = filepath.EvalSymlinks(exe)
	}
	if err != nil {
		fmt.Fprintf(out, "cannot locate this executable: %v\n", err)
		return 1
	}
	configPath, err := filepath.Abs(cfg.Path)
	if err != nil {
		fmt.Fprintln(out, err)
		return 1
	}
	home, _ := os.UserHomeDir()
	spec := serviceSpec{GOOS: runtime.GOOS, Home: home, Executable: exe, ConfigPath: configPath, LogDir: filepath.Join(cfg.DataDir, "logs"), Path: os.Getenv("PATH")}
	var cmdErr error
	switch args[0] {
	case "install":
		cmdErr = installService(spec, out)
	case "uninstall":
		cmdErr = uninstallService(spec, out)
	case "status":
		cmdErr = serviceStatus(spec, out)
	case "restart":
		cmdErr = restartService(spec, out)
	default:
		fmt.Fprintln(out, "usage: fractalbot service install | uninstall | status | restart")
		return 1
	}
	if cmdErr != nil {
		fmt.Fprintln(out, cmdErr)
		return 1
	}
	return 0
}

func uid() string { return strconv.Itoa(os.Getuid()) }

func installService(s serviceSpec, out io.Writer) error {
	switch s.GOOS {
	case "darwin", "linux":
		if err := os.MkdirAll(s.LogDir, 0o700); err != nil {
			return err
		}
		path := s.definitionPath()
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			return err
		}
		if err := os.WriteFile(path, []byte(s.definition()), 0o644); err != nil {
			return err
		}
		if s.GOOS == "darwin" {
			// Replace a loaded definition so the new one takes effect.
			_, _ = serviceRunner("launchctl", "bootout", "gui/"+uid()+"/"+serviceLabel)
			// bootout returns before the old job has fully unloaded, and
			// bootstrapping then fails with an I/O error; retry briefly.
			var msg string
			var err error
			for attempt := 0; attempt < 10; attempt++ {
				if msg, err = serviceRunner("launchctl", "bootstrap", "gui/"+uid(), path); err == nil {
					break
				}
				serviceSleep(time.Second)
			}
			if err != nil {
				return fmt.Errorf("launchctl bootstrap: %v %s", err, msg)
			}
		} else {
			for _, args := range [][]string{{"--user", "daemon-reload"}, {"--user", "enable", "--now", serviceUnit}} {
				if msg, err := serviceRunner("systemctl", args...); err != nil {
					return fmt.Errorf("systemctl %s: %v %s", strings.Join(args, " "), err, msg)
				}
			}
		}
		fmt.Fprintf(out, "Installed %s; logs in %s\n", path, filepath.Join(s.LogDir, serviceLogFile))
		return nil
	case "windows":
		action := strconv.Quote(s.Executable) + " --config " + strconv.Quote(s.ConfigPath)
		if msg, err := serviceRunner("schtasks", "/Create", "/F", "/SC", "ONLOGON", "/RL", "LIMITED", "/TN", serviceTask, "/TR", action); err != nil {
			return fmt.Errorf("schtasks /Create: %v %s", err, msg)
		}
		if msg, err := serviceRunner("schtasks", "/Run", "/TN", serviceTask); err != nil {
			return fmt.Errorf("schtasks /Run: %v %s", err, msg)
		}
		fmt.Fprintf(out, "Installed scheduled task %s (runs at logon)\n", serviceTask)
		return nil
	}
	return errors.New("service install is not supported on " + s.GOOS)
}

func uninstallService(s serviceSpec, out io.Writer) error {
	switch s.GOOS {
	case "darwin":
		_, _ = serviceRunner("launchctl", "bootout", "gui/"+uid()+"/"+serviceLabel)
	case "linux":
		_, _ = serviceRunner("systemctl", "--user", "disable", "--now", serviceUnit)
	case "windows":
		_, _ = serviceRunner("schtasks", "/End", "/TN", serviceTask)
		if msg, err := serviceRunner("schtasks", "/Delete", "/F", "/TN", serviceTask); err != nil {
			return fmt.Errorf("schtasks /Delete: %v %s", err, msg)
		}
		fmt.Fprintln(out, "Removed scheduled task "+serviceTask)
		return nil
	default:
		return errors.New("service uninstall is not supported on " + s.GOOS)
	}
	if err := os.Remove(s.definitionPath()); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	if s.GOOS == "linux" {
		_, _ = serviceRunner("systemctl", "--user", "daemon-reload")
	}
	fmt.Fprintln(out, "Removed "+s.definitionPath())
	return nil
}

func serviceStatus(s serviceSpec, out io.Writer) error {
	var msg string
	var err error
	switch s.GOOS {
	case "darwin":
		msg, err = serviceRunner("launchctl", "print", "gui/"+uid()+"/"+serviceLabel)
	case "linux":
		msg, err = serviceRunner("systemctl", "--user", "status", "--no-pager", serviceUnit)
	case "windows":
		msg, err = serviceRunner("schtasks", "/Query", "/TN", serviceTask, "/V", "/FO", "LIST")
	default:
		return errors.New("service status is not supported on " + s.GOOS)
	}
	fmt.Fprintln(out, msg)
	if err != nil {
		return errors.New("the service is not installed or not running")
	}
	return nil
}

// restartService restarts the gateway so it reads the configuration and
// secrets again. `fractalbot reload` uses it.
func restartService(s serviceSpec, out io.Writer) error {
	var msg string
	var err error
	switch s.GOOS {
	case "darwin":
		msg, err = serviceRunner("launchctl", "kickstart", "-k", "gui/"+uid()+"/"+serviceLabel)
	case "linux":
		msg, err = serviceRunner("systemctl", "--user", "restart", serviceUnit)
	case "windows":
		_, _ = serviceRunner("schtasks", "/End", "/TN", serviceTask)
		msg, err = serviceRunner("schtasks", "/Run", "/TN", serviceTask)
	default:
		return errors.New("service restart is not supported on " + s.GOOS)
	}
	if err != nil {
		return fmt.Errorf("restart failed: %v %s", err, msg)
	}
	fmt.Fprintln(out, "Gateway restarted; it read the configuration and secrets again")
	return nil
}
