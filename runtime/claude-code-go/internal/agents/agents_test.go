package agents

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestListMergesSourcesInOrder(t *testing.T) {
	tmp := t.TempDir()
	home := filepath.Join(tmp, "home")
	project := filepath.Join(tmp, "project")

	if err := os.MkdirAll(filepath.Join(home, "Library", "Application Support", "claude-code-go"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(project, ".claude-code-go"), 0o755); err != nil {
		t.Fatal(err)
	}

	t.Setenv("HOME", home)

	userFile := filepath.Join(home, "Library", "Application Support", "claude-code-go", "agents.json")
	projectFile := filepath.Join(project, ".claude-code-go", "agents.json")
	localFile := filepath.Join(project, ".claude-code-go", "agents.local.json")

	if err := os.WriteFile(userFile, []byte(`{"agents":{"reviewer":{"description":"user reviewer","model":"sonnet"}}}`), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(projectFile, []byte(`{"agents":{"reviewer":{"description":"project reviewer"},"planner":{"description":"project planner"}}}`), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(localFile, []byte(`{"agents":{"reviewer":{"description":"local reviewer"},"qa":{"description":"local qa"}}}`), 0o644); err != nil {
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

	result, err := List("user,project,local")
	if err != nil {
		t.Fatalf("List returned error: %v", err)
	}

	if got := len(result.Definitions); got != 3 {
		t.Fatalf("expected 3 agents, got %d", got)
	}
	if got := result.Definitions["reviewer"].Description; got != "local reviewer" {
		t.Fatalf("expected local override, got %q", got)
	}
	if got := result.Definitions["reviewer"].Source; got != "local" {
		t.Fatalf("expected local source, got %q", got)
	}
	if got := result.Definitions["planner"].Source; got != "project" {
		t.Fatalf("expected project source, got %q", got)
	}
	if got := result.Definitions["qa"].Source; got != "local" {
		t.Fatalf("expected local source, got %q", got)
	}
}

func TestStringShowsEmptyState(t *testing.T) {
	result := ListResult{
		Sources:     []string{"user", "project", "local"},
		Checked:     []string{"user=/tmp/a", "project=/tmp/b", "local=/tmp/c"},
		Definitions: map[string]Definition{},
	}
	out := result.String()
	if !strings.Contains(out, "agent_count=0") || !strings.Contains(out, "agents=none") {
		t.Fatalf("unexpected output: %s", out)
	}
}
