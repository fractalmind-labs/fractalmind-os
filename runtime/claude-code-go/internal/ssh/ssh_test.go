package ssh

import (
	"strings"
	"testing"
)

func TestRunDefaults(t *testing.T) {
	result, err := Run([]string{"demo-host"})
	if err != nil {
		t.Fatalf("Run returned error: %v", err)
	}
	if result.Status != "stub" || result.Action != "connect-ssh" || result.Host != "demo-host" {
		t.Fatalf("unexpected result: %#v", result)
	}
	if result.Dir != "" || result.PermissionMode != "" || result.DangerouslySkipPermissions || result.Local {
		t.Fatalf("unexpected defaults: %#v", result)
	}
	output := result.String()
	for _, needle := range []string{
		"status=stub",
		"action=connect-ssh",
		"host=demo-host",
		"dir=none",
		"permission_mode=none",
		"dangerously_skip_permissions=false",
		"local_mode=false",
	} {
		if !strings.Contains(output, needle) {
			t.Fatalf("expected output to contain %q, got:\n%s", needle, output)
		}
	}
}

func TestRunAcceptsDirAndFlags(t *testing.T) {
	result, err := Run([]string{
		"demo-host",
		"/tmp/work",
		"--permission-mode", "auto",
		"--dangerously-skip-permissions",
		"--local",
	})
	if err != nil {
		t.Fatalf("Run returned error: %v", err)
	}
	if result.Host != "demo-host" || result.Dir != "/tmp/work" || result.PermissionMode != "auto" {
		t.Fatalf("unexpected parsed result: %#v", result)
	}
	if !result.DangerouslySkipPermissions || !result.Local {
		t.Fatalf("expected flags to be true, got %#v", result)
	}
}

func TestRunAcceptsFlagsBeforeHost(t *testing.T) {
	result, err := Run([]string{
		"--permission-mode=auto",
		"--local",
		"demo-host",
	})
	if err != nil {
		t.Fatalf("Run returned error: %v", err)
	}
	if result.Host != "demo-host" || result.PermissionMode != "auto" || !result.Local {
		t.Fatalf("unexpected result: %#v", result)
	}
}

func TestRunRejectsMissingHost(t *testing.T) {
	_, err := Run(nil)
	if err == nil || !strings.Contains(err.Error(), "usage: claude-code-go ssh <host> [dir]") {
		t.Fatalf("expected usage error, got %v", err)
	}
}

func TestRunRejectsUnknownOption(t *testing.T) {
	_, err := Run([]string{"demo-host", "--unknown"})
	if err == nil || !strings.Contains(err.Error(), "unknown option") {
		t.Fatalf("expected unknown option error, got %v", err)
	}
}

func TestRunRejectsTooManyPositionals(t *testing.T) {
	_, err := Run([]string{"demo-host", "/tmp/work", "extra"})
	if err == nil || !strings.Contains(err.Error(), "usage: claude-code-go ssh <host> [dir]") {
		t.Fatalf("expected usage error, got %v", err)
	}
}
