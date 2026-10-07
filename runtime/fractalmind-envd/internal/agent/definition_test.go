package agent

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"
)

func writeHome(t *testing.T, frontmatter string) string {
	t.Helper()
	home, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(home, "AGENTS.md"), []byte("---\n"+frontmatter+"---\n\n# Body\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	for _, d := range []string{".agents/skills/agent-manager", ".agents/skills/notifier", ".claude/skills/agent-manager", "agents/EMP_0001", "agents/EMP_0002"} {
		if err := os.MkdirAll(filepath.Join(home, d), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	os.WriteFile(filepath.Join(home, "agents/EMP_0001/AGENTS.md"), []byte("---\nname: dev\n---\n"), 0o644)
	return home
}

func TestReadDefinitionFromAgentsFrontmatter(t *testing.T) {
	codex := t.TempDir()
	t.Setenv("CODEX_HOME", codex)
	os.WriteFile(filepath.Join(codex, "research.config.toml"), []byte("model_provider = \"local\"\nmodel = \"ornith\"\n[model_providers.local]\nmodel = \"not-this\"\napi_key = \"secret-never-read\"\n"), 0o600)
	home := writeHome(t, `name: main
namespace: research
description: "Researcher\nwith two lines"
launcher: codex
launcher_args:
  - --profile
  - research
  - --dangerously-bypass-approvals-and-sandbox
heartbeat:
  cron: "0 * * * *"
  enabled: true
schedules:
  - name: morning
  - name: evening
rom:
  name: manager-heavy-core
  version: 0.6.0
`)
	def := ReadDefinition(filepath.Join(home, "agents", "EMP_0002"))
	if def == nil {
		t.Fatal("definition not found from a subfolder")
	}
	want := Definition{Home: home, Name: "main", Namespace: "research", Description: "Researcher with two lines", Launcher: "codex", Profile: "research", Model: "ornith", Heartbeat: "0 * * * *", Schedules: 2, ROM: &ROMRef{Name: "manager-heavy-core", Version: "0.6.0"}, Skills: 2, SubAgents: 1}
	if !reflect.DeepEqual(*def, want) {
		t.Fatalf("got %+v", *def)
	}
}

func TestReadDefinitionModelSourcesAndRejections(t *testing.T) {
	codex := t.TempDir()
	t.Setenv("CODEX_HOME", codex)
	os.WriteFile(filepath.Join(codex, "config.toml"), []byte("model = \"gpt-default\"\n"), 0o600)
	explicit := writeHome(t, "name: main\nlauncher: codex\nlauncher_args: [--model=gpt-5.5]\nheartbeat:\n  cron: \"*/5 * * * *\"\n  enabled: false\n")
	def := ReadDefinition(explicit)
	if def.Model != "gpt-5.5" || def.Heartbeat != "" || def.ROM != nil || def.Namespace != "" {
		t.Fatalf("explicit model / disabled heartbeat: %+v", def)
	}
	if def := ReadDefinition(writeHome(t, "name: main\nlauncher: codex\n")); def.Model != "gpt-default" {
		t.Fatalf("default profile model: %+v", def)
	}
	if def := ReadDefinition(writeHome(t, "name: main\nlauncher: claude\n")); def.Model != "" {
		t.Fatalf("non-codex launcher read a Codex model: %+v", def)
	}
	if ReadDefinition(writeHome(t, "description: no name\n")) != nil {
		t.Fatal("frontmatter without name accepted")
	}
	if ReadDefinition(writeHome(t, "name: main\nnamespace: \"bad name\\u0001\"\n")).Namespace != "" {
		t.Fatal("unsafe namespace kept")
	}
	if ReadDefinition(t.TempDir()) != nil {
		t.Fatal("folder without AGENTS.md treated as a Home")
	}
}

func TestDiscoveryIncludesAgentManagerHomesBeyondLegacyPrefixes(t *testing.T) {
	if !supportsProcessBirth {
		t.Skip("tmux continuity unsupported on this OS")
	}
	t.Setenv("CODEX_HOME", t.TempDir())
	home := writeHome(t, "name: main\nnamespace: writer\nlauncher: codex\n")
	plain, _ := filepath.EvalSymlinks(t.TempDir())
	row := func(session, pane, path string) string {
		return strings.Join([]string{"123", session, pane, "456", "0", path}, discoverySep)
	}
	raw := strings.Join([]string{row("writer--main", "%1", home), row("notes", "%2", plain), row("agent-legacy", "%3", plain)}, "\n") + "\n"
	d := discover("tmux", func(context.Context) ([]byte, error) { return []byte(raw), nil }, func(pid int) (string, error) { return fmt.Sprintf("b:%d", pid), nil })
	if d.State != "complete" || len(d.Instances) != 2 {
		t.Fatalf("want the Home session and the legacy one: %+v", d)
	}
	byName := map[string]Instance{}
	for _, r := range d.Instances {
		byName[r.Session] = r
	}
	if a := byName["writer--main"].Agent; a == nil || a.Namespace != "writer" || a.Home != home {
		t.Fatalf("Home definition missing: %+v", byName["writer--main"])
	}
	if byName["agent-legacy"].Agent != nil {
		t.Fatal("legacy session without a Home got a definition")
	}
	if _, ok := byName["notes"]; ok {
		t.Fatal("a plain tmux session was reported as an Agent")
	}
	if err := ValidateDiscovery(&d, time.Now().Add(time.Second)); err != nil {
		t.Fatal(err)
	}
	bad := d
	bad.Instances = append([]Instance(nil), d.Instances...)
	for i := range bad.Instances {
		if bad.Instances[i].Agent != nil {
			copy := *bad.Instances[i].Agent
			copy.Name = "bad\x01"
			bad.Instances[i].Agent = &copy
		}
	}
	if ValidateDiscovery(&bad, time.Now().Add(time.Second)) == nil {
		t.Fatal("unsafe definition accepted")
	}
}
