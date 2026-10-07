package agent

import (
	"os"
	"os/exec"
	"sync"
)

var (
	tmuxOnce sync.Once
	tmuxPath = "tmux"
)

// tmuxBinary finds tmux even when envd runs as a login service with a minimal
// PATH (launchd: /usr/bin:/bin:/usr/sbin:/sbin), where Homebrew's is missing.
func tmuxBinary() string {
	tmuxOnce.Do(func() {
		if p, err := exec.LookPath("tmux"); err == nil {
			tmuxPath = p
			return
		}
		for _, p := range []string{os.Getenv("TMUX_BIN"), "/opt/homebrew/bin/tmux", "/usr/local/bin/tmux", "/opt/local/bin/tmux", "/usr/bin/tmux"} {
			if info, err := os.Stat(p); p != "" && err == nil && !info.IsDir() && info.Mode()&0o111 != 0 {
				tmuxPath = p
				return
			}
		}
	})
	return tmuxPath
}
