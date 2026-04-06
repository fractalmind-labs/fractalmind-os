package automode

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestDefaultsHaveExpectedShape(t *testing.T) {
	rules := Defaults()
	if len(rules.Allow) == 0 || len(rules.SoftDeny) == 0 || len(rules.Environment) == 0 {
		t.Fatalf("expected non-empty default rules, got %#v", rules)
	}
}

func TestEffectiveConfigFallsBackPerSection(t *testing.T) {
	tmp := t.TempDir()
	home := filepath.Join(tmp, "home")
	project := filepath.Join(tmp, "project")
	flagFile := filepath.Join(tmp, "flag-settings.json")
	policyFile := filepath.Join(tmp, "policy-settings.json")

	if err := os.MkdirAll(filepath.Join(home, ".claude"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(project, ".claude"), 0o755); err != nil {
		t.Fatal(err)
	}

	t.Setenv("HOME", home)
	t.Setenv("CLAUDE_CODE_GO_FLAG_SETTINGS_PATH", flagFile)
	t.Setenv("CLAUDE_CODE_GO_POLICY_SETTINGS_PATH", policyFile)

	userFile := filepath.Join(home, ".claude", "settings.json")
	localFile := filepath.Join(project, ".claude", "settings.local.json")

	if err := os.WriteFile(userFile, []byte(`{"autoMode":{"allow":["user allow"],"environment":["user env"]}}`), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(localFile, []byte(`{"autoMode":{"allow":["local allow"],"soft_deny":["local deny"]}}`), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(flagFile, []byte(`{"autoMode":{"environment":["flag env"]}}`), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(policyFile, []byte(`{"autoMode":{"deny":["policy deny"]}}`), 0o644); err != nil {
		t.Fatal(err)
	}

	oldWD, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = os.Chdir(oldWD) }()
	if err := os.Chdir(project); err != nil {
		t.Fatal(err)
	}

	rules, err := EffectiveConfig()
	if err != nil {
		t.Fatalf("EffectiveConfig returned error: %v", err)
	}

	if got := strings.Join(rules.Allow, " | "); got != "user allow | local allow" {
		t.Fatalf("unexpected allow rules: %s", got)
	}
	if got := strings.Join(rules.SoftDeny, " | "); got != "local deny | policy deny" {
		t.Fatalf("unexpected soft_deny rules: %s", got)
	}
	if got := strings.Join(rules.Environment, " | "); got != "user env | flag env" {
		t.Fatalf("unexpected environment rules: %s", got)
	}
}

func TestEffectiveConfigUsesDefaultsWhenSectionMissing(t *testing.T) {
	tmp := t.TempDir()
	home := filepath.Join(tmp, "home")
	project := filepath.Join(tmp, "project")
	if err := os.MkdirAll(filepath.Join(home, ".claude"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(project, ".claude"), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("HOME", home)

	userFile := filepath.Join(home, ".claude", "settings.json")
	if err := os.WriteFile(userFile, []byte(`{"autoMode":{"soft_deny":["custom deny"]}}`), 0o644); err != nil {
		t.Fatal(err)
	}

	oldWD, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = os.Chdir(oldWD) }()
	if err := os.Chdir(project); err != nil {
		t.Fatal(err)
	}

	rules, err := EffectiveConfig()
	if err != nil {
		t.Fatalf("EffectiveConfig returned error: %v", err)
	}

	defaults := Defaults()
	if strings.Join(rules.Allow, " | ") != strings.Join(defaults.Allow, " | ") {
		t.Fatalf("expected allow defaults, got %#v", rules.Allow)
	}
	if strings.Join(rules.Environment, " | ") != strings.Join(defaults.Environment, " | ") {
		t.Fatalf("expected environment defaults, got %#v", rules.Environment)
	}
	if got := strings.Join(rules.SoftDeny, " | "); got != "custom deny" {
		t.Fatalf("expected custom soft_deny, got %s", got)
	}
}
