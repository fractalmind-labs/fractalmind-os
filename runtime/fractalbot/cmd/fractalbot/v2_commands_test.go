package main

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalbot/internal/configv2"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalbot/internal/secrets"
)

func writeV2Config(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	workspace := filepath.Join(dir, "work")
	if err := os.Mkdir(workspace, 0o755); err != nil {
		t.Fatal(err)
	}
	cfg := "version: 2\ndataDir: " + filepath.Join(dir, "data") + "\nsecrets: {store: file}\n" +
		"channels:\n  telegram:\n    main: {botToken: secret:telegram-main}\n" +
		"agents:\n  bot:\n    workspace: " + workspace + "\n    runtime: agentManager\n    channels: [telegram.main]\n"
	path := filepath.Join(dir, "config.yaml")
	if err := os.WriteFile(path, []byte(cfg), 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}

func useV2Host(t *testing.T, stdin string) {
	t.Helper()
	oldPlatform, oldOpts, oldStdin := v2Platform, v2CheckOptions, v2Stdin
	t.Cleanup(func() { v2Platform, v2CheckOptions, v2Stdin = oldPlatform, oldOpts, oldStdin })
	v2Platform = func() configv2.Platform {
		p := configv2.HostPlatform()
		p.GOOS = "linux"
		return p
	}
	v2CheckOptions = func() configv2.CheckOptions {
		return configv2.CheckOptions{
			Secrets:  secrets.Environment{GOOS: "linux", LookupEnv: func(string) (string, bool) { return "", false }, Exists: func(string) bool { return false }},
			LookPath: func(name string) (string, error) { return "/usr/bin/" + name, nil },
		}
	}
	v2Stdin = strings.NewReader(stdin)
}

func TestV2ConfigCheckAndSecretCommands(t *testing.T) {
	path := writeV2Config(t)
	useV2Host(t, "token-value-123456\n")
	run := func(args ...string) (int, string) {
		var out bytes.Buffer
		code := runWithContext(context.Background(), append([]string{"--config", path}, args...), &out)
		return code, out.String()
	}

	if code, out := run("config", "check"); code != 1 || !strings.Contains(out, "telegram-main [file]: missing") {
		t.Fatalf("check before set: %d\n%s", code, out)
	}
	if code, out := run("secret", "set", "telegram-main"); code != 0 || !strings.Contains(out, "stored in the file store") {
		t.Fatalf("secret set: %d\n%s", code, out)
	}
	code, out := run("config", "check")
	if code != 0 || !strings.HasSuffix(strings.TrimSpace(out), "OK") || strings.Contains(out, "token-value-123456") {
		t.Fatalf("check after set: %d\n%s", code, out)
	}
	if code, out := run("secret", "rm", "telegram-main"); code != 0 {
		t.Fatalf("secret rm: %d\n%s", code, out)
	}
	if code, _ := run("secret", "check"); code != 1 {
		t.Fatalf("secret check after rm: %d", code)
	}
}

func TestV2CommandRejectsVersion1Config(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.yaml")
	if err := os.WriteFile(path, []byte("agents:\n  router: ohMyCode\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	useV2Host(t, "")
	var out bytes.Buffer
	if code := runWithContext(context.Background(), []string{"--config", path, "config", "check"}, &out); code != 1 || !strings.Contains(out.String(), "version 1") {
		t.Fatalf("got %d\n%s", code, out.String())
	}
}
