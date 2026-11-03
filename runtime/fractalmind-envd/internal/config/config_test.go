package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestRequireSignedCommandsDefaultsToTrue(t *testing.T) {
	// A Config built in code without going through Load must stay fail-closed:
	// the zero value of SecurityConfig.RequireSignedCommands is nil.
	if !(&Config{}).RequireSignedCommands() {
		t.Fatal("zero-value Config must require signed commands")
	}
	if !DefaultConfig().RequireSignedCommands() {
		t.Fatal("DefaultConfig must require signed commands")
	}
	var nilConfig *Config
	if !nilConfig.RequireSignedCommands() {
		t.Fatal("nil Config must require signed commands")
	}
}

func TestLoadRequireSignedCommands(t *testing.T) {
	cases := []struct {
		name string
		yaml string
		want bool
	}{
		{"absent", "identity:\n  hostname: node\n", true},
		{"empty section", "security: {}\n", true},
		{"explicit true", "security:\n  require_signed_commands: true\n", true},
		{"explicit false", "security:\n  require_signed_commands: false\n", false},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "sentinel.yaml")
			if err := os.WriteFile(path, []byte(tc.yaml), 0o600); err != nil {
				t.Fatalf("write config: %v", err)
			}
			cfg, err := Load(path)
			if err != nil {
				t.Fatalf("Load: %v", err)
			}
			if got := cfg.RequireSignedCommands(); got != tc.want {
				t.Fatalf("RequireSignedCommands() = %v, want %v", got, tc.want)
			}
		})
	}
}

func TestLoadMissingFileStaysFailClosed(t *testing.T) {
	cfg, err := Load(filepath.Join(t.TempDir(), "absent.yaml"))
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if !cfg.RequireSignedCommands() {
		t.Fatal("a missing config file must not open the unsigned command path")
	}
}
