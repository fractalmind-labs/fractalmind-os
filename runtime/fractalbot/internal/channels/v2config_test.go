package channels

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalbot/internal/configv2"
)

// v2Config parses a configuration whose agents all use one temporary
// agentManager workspace. channels is the YAML under channels:, agents maps
// each agent to its channel references.
func v2Config(t *testing.T, channels string, agents map[string]string) *configv2.Config {
	t.Helper()
	ws := t.TempDir()
	yaml := "version: 2\ndataDir: " + filepath.Join(t.TempDir(), "data") + "\nchannels:\n" + channels + "agents:\n"
	for name, refs := range agents {
		yaml += "  " + name + ":\n    workspace: " + ws + "\n    runtime: agentManager\n    channels: [" + refs + "]\n"
	}
	p := configv2.HostPlatform()
	p.GOOS = "darwin"
	cfg, err := configv2.Parse([]byte(yaml), p)
	if err != nil {
		t.Fatalf("config: %v", err)
	}
	_ = os.MkdirAll(cfg.DataDir, 0o700)
	return cfg
}
