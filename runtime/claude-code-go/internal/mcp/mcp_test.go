package mcp

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestListMergesScopesWithExpectedPrecedence(t *testing.T) {
	tmp := t.TempDir()
	home := filepath.Join(tmp, "home")
	projectRoot := filepath.Join(tmp, "repo")
	worktree := filepath.Join(projectRoot, "nested", "app")

	mustMkdirAll(t, filepath.Join(home, ".claude"))
	mustMkdirAll(t, filepath.Join(worktree, ".claude"))
	t.Setenv("HOME", home)

	mustWriteFile(t, filepath.Join(home, ".claude", "settings.json"), `{"mcpServers":{"shared":{"type":"http","url":"https://user.example.test"},"user-only":{"command":"uvx","args":["user-tool"]}}}`)
	mustWriteFile(t, filepath.Join(projectRoot, ".mcp.json"), `{"mcpServers":{"shared":{"command":"uvx","args":["project-tool"]},"project-only":{"type":"sse","url":"https://project.example.test/sse"}}}`)
	mustWriteFile(t, filepath.Join(worktree, ".claude", "settings.local.json"), `{"mcpServers":{"shared":{"type":"sse","url":"https://local.example.test/sse","headers":{"Authorization":"Bearer demo"},"oauth":{"clientId":"demo-client"}},"local-only":{"command":"npx","args":["-y","demo"],"env":{"FOO":"bar"}}}}`)

	withWorkingDir(t, worktree, func() {
		result, err := List()
		if err != nil {
			t.Fatalf("List returned error: %v", err)
		}
		if got := len(result.Servers); got != 4 {
			t.Fatalf("expected 4 merged servers, got %d", got)
		}
		if got := result.Servers["shared"].Scope; got != "local" {
			t.Fatalf("expected local override, got %q", got)
		}
		if got := result.Servers["project-only"].Scope; got != "project" {
			t.Fatalf("expected project scope, got %q", got)
		}
		if got := result.Servers["user-only"].Scope; got != "user" {
			t.Fatalf("expected user scope, got %q", got)
		}
		if got := strings.Join(result.Servers["local-only"].EnvKeys, ","); got != "FOO" {
			t.Fatalf("expected env key listing, got %q", got)
		}
	})
}

func TestAddAndRemoveLocalPreservesOtherSettings(t *testing.T) {
	tmp := t.TempDir()
	home := filepath.Join(tmp, "home")
	project := filepath.Join(tmp, "project")
	mustMkdirAll(t, filepath.Join(home, ".claude"))
	mustMkdirAll(t, filepath.Join(project, ".claude"))
	t.Setenv("HOME", home)
	mustWriteFile(t, filepath.Join(project, ".claude", "settings.local.json"), `{"theme":"dark","mcpServers":{"keep":{"type":"http","url":"https://keep.example/mcp"}}}`)

	withWorkingDir(t, project, func() {
		result, err := Add(AddOptions{
			Scope:     "local",
			Transport: "stdio",
			Name:      "demo",
			Target:    "npx",
			Args:      []string{"-y", "demo-mcp"},
			Env:       map[string]string{"FOO": "bar"},
		})
		if err != nil {
			t.Fatalf("Add returned error: %v", err)
		}
		if result.Scope != "local" || result.Type != "stdio" {
			t.Fatalf("unexpected add result: %#v", result)
		}
		settings := readJSONFile(t, filepath.Join(project, ".claude", "settings.local.json"))
		if got := settings["theme"]; got != "dark" {
			t.Fatalf("expected theme preserved, got %#v", got)
		}
		servers := settings["mcpServers"].(map[string]any)
		if _, ok := servers["keep"]; !ok {
			t.Fatalf("expected keep server preserved, got %#v", servers)
		}
		if _, ok := servers["demo"]; !ok {
			t.Fatalf("expected demo server added, got %#v", servers)
		}

		removed, err := Remove(RemoveOptions{Name: "demo", Scope: "local"})
		if err != nil {
			t.Fatalf("Remove returned error: %v", err)
		}
		if removed.Status != "removed" {
			t.Fatalf("unexpected remove result: %#v", removed)
		}
		settings = readJSONFile(t, filepath.Join(project, ".claude", "settings.local.json"))
		servers = settings["mcpServers"].(map[string]any)
		if _, ok := servers["demo"]; ok {
			t.Fatalf("expected demo removed, got %#v", servers)
		}
		if _, ok := servers["keep"]; !ok {
			t.Fatalf("expected keep server still present, got %#v", servers)
		}
	})
}

func TestAddUserHTTPAndAmbiguousRemove(t *testing.T) {
	tmp := t.TempDir()
	home := filepath.Join(tmp, "home")
	project := filepath.Join(tmp, "project")
	mustMkdirAll(t, filepath.Join(home, ".claude"))
	mustMkdirAll(t, filepath.Join(project, ".claude"))
	t.Setenv("HOME", home)

	withWorkingDir(t, project, func() {
		_, err := Add(AddOptions{
			Scope:        "user",
			Transport:    "http",
			Name:         "sentry",
			Target:       "https://mcp.sentry.dev/mcp",
			Headers:      map[string]string{"Authorization": "Bearer demo"},
			ClientID:     "client-demo",
			CallbackPort: 7777,
		})
		if err != nil {
			t.Fatalf("Add user HTTP returned error: %v", err)
		}
		_, err = Add(AddOptions{
			Scope:     "local",
			Transport: "stdio",
			Name:      "sentry",
			Target:    "npx",
			Args:      []string{"-y", "sentry-local"},
		})
		if err != nil {
			t.Fatalf("Add local stdio returned error: %v", err)
		}
		_, err = Remove(RemoveOptions{Name: "sentry"})
		if err == nil || !strings.Contains(err.Error(), "exists in multiple scopes") {
			t.Fatalf("expected ambiguous remove error, got %v", err)
		}
		settings := readJSONFile(t, filepath.Join(home, ".claude", "settings.json"))
		servers := settings["mcpServers"].(map[string]any)
		server := servers["sentry"].(map[string]any)
		if server["type"] != "http" {
			t.Fatalf("expected http server, got %#v", server)
		}
		if _, ok := server["oauth"]; !ok {
			t.Fatalf("expected oauth written, got %#v", server)
		}
	})
}

func TestGetDefaultsMissingTypeToStdioAndTraversesParentMcpFiles(t *testing.T) {
	tmp := t.TempDir()
	home := filepath.Join(tmp, "home")
	projectRoot := filepath.Join(tmp, "repo")
	worktree := filepath.Join(projectRoot, "nested", "app")
	mustMkdirAll(t, filepath.Join(home, ".claude"))
	mustMkdirAll(t, worktree)
	t.Setenv("HOME", home)
	mustWriteFile(t, filepath.Join(projectRoot, ".mcp.json"), `{"mcpServers":{"parent-tool":{"command":"uvx","args":["parent-mcp"]}}}`)

	withWorkingDir(t, worktree, func() {
		server, err := Get("parent-tool")
		if err != nil {
			t.Fatalf("Get returned error: %v", err)
		}
		if server.Type != "stdio" {
			t.Fatalf("expected stdio default, got %q", server.Type)
		}
	})
}

func TestListShowsEmptyState(t *testing.T) {
	tmp := t.TempDir()
	home := filepath.Join(tmp, "home")
	project := filepath.Join(tmp, "project")
	mustMkdirAll(t, filepath.Join(home, ".claude"))
	mustMkdirAll(t, filepath.Join(project, ".claude"))
	t.Setenv("HOME", home)

	withWorkingDir(t, project, func() {
		result, err := List()
		if err != nil {
			t.Fatalf("List returned error: %v", err)
		}
		if !strings.Contains(result.String(), "servers=none") {
			t.Fatalf("unexpected empty output: %s", result.String())
		}
	})
}

func readJSONFile(t *testing.T, path string) map[string]any {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var payload map[string]any
	if err := json.Unmarshal(data, &payload); err != nil {
		t.Fatal(err)
	}
	return payload
}

func withWorkingDir(t *testing.T, path string, fn func()) {
	t.Helper()
	oldWD, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = os.Chdir(oldWD) }()
	if err := os.Chdir(path); err != nil {
		t.Fatal(err)
	}
	fn()
}

func mustMkdirAll(t *testing.T, path string) {
	t.Helper()
	if err := os.MkdirAll(path, 0o755); err != nil {
		t.Fatal(err)
	}
}

func mustWriteFile(t *testing.T, path string, content string) {
	t.Helper()
	mustMkdirAll(t, filepath.Dir(path))
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}
