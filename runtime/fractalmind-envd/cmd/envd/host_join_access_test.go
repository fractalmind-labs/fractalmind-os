package main

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/config"
)

func accessFixture(t *testing.T, mutate func(map[string]any)) []byte {
	t.Helper()
	id := func(b string) string { return "0x" + strings.Repeat(b, 32) }
	prefix := "FHI1:testnet:" + id("cd") + ":" + strings.Repeat("5a", 32)
	sum := sha256.Sum256([]byte(prefix))
	fields := map[string]any{
		"v": 1, "network": "testnet", "rpc": "https://fullnode.testnet.sui.io",
		"chain_identifier":    "69WiPg3DAQiwdxfncX6wYQ2siKwAe6L9BZthQea3JNMD",
		"protocol_package_id": id("01"), "protocol_original_package_id": id("01"),
		"okr_package_id": id("02"), "okr_original_package_id": id("02"),
		"direct_package_id": id("03"), "direct_original_package_id": id("03"),
		"protocol_registry_id": id("04"), "org_id": id("05"),
		"host_join_gas_budget": 30000000, "invite": prefix + ":" + hex.EncodeToString(sum[:4]),
	}
	if mutate != nil {
		mutate(fields)
	}
	payload, _ := json.Marshal(fields)
	return []byte(hostJoinAccessPrefix + base64.RawURLEncoding.EncodeToString(payload))
}

func TestHostJoinAccessParsesAndWritesALoadableConfig(t *testing.T) {
	access, invite, err := parseHostJoinAccess(append(accessFixture(t, nil), '\n'))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(string(invite), "FHI1:testnet:") || access.Invite != "" {
		t.Fatal("invitation must be returned separately and not kept in the public fields")
	}
	path := filepath.Join(t.TempDir(), "sentinel.yaml")
	if err = os.WriteFile(path, hostJoinConfig(access, "host", `Mac "Studio"`), 0o600); err != nil {
		t.Fatal(err)
	}
	cfg, err := config.Load(path)
	if err != nil {
		t.Fatal(err)
	}
	if !sameOrganization(cfg, access) || cfg.Identity.Hostname != `Mac "Studio"` || cfg.Runtime.Enabled || cfg.Agents.AutoRestart || cfg.Agents.AllowShell || cfg.Roles.Coordinator || cfg.SUI.HostJoinGasBudget != 30000000 {
		t.Fatalf("generated configuration is not an observation-only worker of this organization: %+v", cfg.SUI)
	}
	if text, _ := os.ReadFile(path); strings.Contains(string(text), "FHI1") {
		t.Fatal("the invitation leaked into the configuration file")
	}
	other := access
	other.OrgID = "0x" + strings.Repeat("06", 32)
	if sameOrganization(cfg, other) {
		t.Fatal("a configuration of another organization must not be reused")
	}
}

func TestHostJoinAccessRejectsTamperedInput(t *testing.T) {
	cases := map[string][]byte{
		"no prefix":        []byte("FHI1:testnet:abc"),
		"bad base64":       []byte(hostJoinAccessPrefix + "!!!"),
		"too long":         []byte(hostJoinAccessPrefix + strings.Repeat("A", maxHostJoinAccess)),
		"unknown field":    accessFixture(t, func(m map[string]any) { m["extra"] = true }),
		"wrong version":    accessFixture(t, func(m map[string]any) { m["v"] = 2 }),
		"network mismatch": accessFixture(t, func(m map[string]any) { m["network"] = "mainnet" }),
		"bad checksum":     accessFixture(t, func(m map[string]any) { m["invite"] = m["invite"].(string)[:len(m["invite"].(string))-1] + "0" }),
		"plain http rpc":   accessFixture(t, func(m map[string]any) { m["rpc"] = "http://fullnode.example" }),
		"short org":        accessFixture(t, func(m map[string]any) { m["org_id"] = "0x05" }),
		"zero budget":      accessFixture(t, func(m map[string]any) { m["host_join_gas_budget"] = 0 }),
	}
	for name, raw := range cases {
		if _, invite, err := parseHostJoinAccess(raw); err == nil || invite != nil {
			t.Errorf("%s: expected rejection", name)
		}
	}
}

// The App computes the same value (apps/fractalmind-app/tests/host-join-access.test.ts).
func TestHostJoinFingerprintGolden(t *testing.T) {
	got := hostJoinFingerprint("0x"+strings.Repeat("05", 32), "0x"+strings.Repeat("07", 32))
	if len(got) != 9 || got[4] != '-' {
		t.Fatalf("unexpected fingerprint shape %q", got)
	}
	t.Logf("golden fingerprint %s", got)
	if got != "MJ3Q-SB91" {
		t.Fatalf("fingerprint changed: %s", got)
	}
}
