package main

import (
	"encoding/json"
	"errors"
	"os"
	"strings"
	"testing"

	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/config"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/hostidentity"
)

type fixtureHostStore struct {
	data    []byte
	failure error
	creates int
}

func (s *fixtureHostStore) Get(string) ([]byte, error) {
	if s.failure != nil {
		return nil, s.failure
	}
	if s.data == nil {
		return nil, hostidentity.ErrNotFound
	}
	return append([]byte(nil), s.data...), nil
}
func (s *fixtureHostStore) Create(string, []byte) error {
	s.creates++
	return errors.New("daemon must not initialize keys")
}
func chainRuntimeConfig() *config.Config {
	cfg := config.DefaultConfig()
	cfg.Runtime.Enabled = true
	cfg.SUI.Enabled = true
	cfg.SUI.RPC = "http://127.0.0.1:29000"
	cfg.SUI.OrgID = "0x2"
	cfg.SUI.ProtocolPackageID = "0x3"
	cfg.Identity.KeyProfile = "fixture"
	return cfg
}
func TestProductionFactoryRejectsFileAuthorityAndMissingChain(t *testing.T) {
	cfg := chainRuntimeConfig()
	file := t.TempDir() + "/authority.json"
	raw, _ := json.Marshal(map[string]any{"capabilities": []any{}})
	if err := os.WriteFile(file, raw, 0600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("FRACTALMIND_NODE_COMMAND_AUTHORITY_FILE", file)
	if _, err := newRuntimeCommandExecutorWithStore(cfg, &fixtureHostStore{}); err == nil || !strings.Contains(err.Error(), "authority files") {
		t.Fatalf("file authority selected: %v", err)
	}
	t.Setenv("FRACTALMIND_NODE_COMMAND_AUTHORITY_FILE", "")
	for _, field := range []string{"enabled", "rpc", "org", "package"} {
		t.Run(field, func(t *testing.T) {
			broken := chainRuntimeConfig()
			switch field {
			case "enabled":
				broken.SUI.Enabled = false
			case "rpc":
				broken.SUI.RPC = ""
			case "org":
				broken.SUI.OrgID = ""
			case "package":
				broken.SUI.ProtocolPackageID = ""
			}
			if _, err := newRuntimeCommandExecutorWithStore(broken, &fixtureHostStore{}); err == nil {
				t.Fatal("missing chain config allowed runtime")
			}
		})
	}
}
func TestProductionDaemonNeverReplacesUnavailableHostKeys(t *testing.T) {
	t.Setenv("FRACTALMIND_NODE_COMMAND_AUTHORITY_FILE", "")
	for _, failure := range []error{hostidentity.ErrNotFound, errors.New("OS store locked"), errors.New("OS store offline")} {
		store := &fixtureHostStore{failure: failure}
		if _, err := newRuntimeCommandExecutorWithStore(chainRuntimeConfig(), store); !errors.Is(err, failure) || store.creates != 0 {
			t.Fatalf("identity replaced: err=%v creates=%d", err, store.creates)
		}
	}
}
