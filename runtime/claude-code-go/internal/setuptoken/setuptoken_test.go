package setuptoken

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestBuildResultNeedsToken(t *testing.T) {
	t.Setenv(envVarName, "")
	result, err := BuildResult(Options{})
	if err != nil {
		t.Fatalf("BuildResult returned error: %v", err)
	}
	if result.Status != "needs_token" {
		t.Fatalf("expected needs_token, got %q", result.Status)
	}
	if !strings.Contains(result.NextStep, envVarName) {
		t.Fatalf("expected next step to mention env var, got %q", result.NextStep)
	}
}

func TestBuildResultUsesArgAndWritesEnvFile(t *testing.T) {
	tmp := t.TempDir()
	path := filepath.Join(tmp, "oauth-token.env")
	result, err := BuildResult(Options{Token: "tok-demo-1234567890", WriteEnvFile: path})
	if err != nil {
		t.Fatalf("BuildResult returned error: %v", err)
	}
	if result.Status != "ready" {
		t.Fatalf("expected ready, got %q", result.Status)
	}
	if result.TokenSource != "arg" {
		t.Fatalf("expected arg token source, got %q", result.TokenSource)
	}
	if result.WriteResult != "success" {
		t.Fatalf("expected write success, got %q", result.WriteResult)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if got := string(data); got != "export CLAUDE_CODE_OAUTH_TOKEN=tok-demo-1234567890\n" {
		t.Fatalf("unexpected env file contents: %q", got)
	}
}

func TestBuildResultFallsBackToEnv(t *testing.T) {
	t.Setenv(envVarName, "tok-env-abcdefgh")
	result, err := BuildResult(Options{})
	if err != nil {
		t.Fatalf("BuildResult returned error: %v", err)
	}
	if result.TokenSource != "env" {
		t.Fatalf("expected env token source, got %q", result.TokenSource)
	}
	if !strings.Contains(result.ExportCommand, "tok-env-abcdefgh") {
		t.Fatalf("expected export command to include token, got %q", result.ExportCommand)
	}
}
