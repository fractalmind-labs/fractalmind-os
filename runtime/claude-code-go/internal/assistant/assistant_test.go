package assistant

import (
	"strings"
	"testing"
)

func TestRunWithoutSessionIDRequestsDiscovery(t *testing.T) {
	result, err := Run(nil)
	if err != nil {
		t.Fatalf("Run returned error: %v", err)
	}
	if result.Status != "stub" || result.Action != "discover-sessions" || result.SessionID != "" {
		t.Fatalf("unexpected result: %#v", result)
	}
	output := result.String()
	for _, needle := range []string{
		"status=stub",
		"session_id=none",
		"action=discover-sessions",
	} {
		if !strings.Contains(output, needle) {
			t.Fatalf("expected output to contain %q, got:\n%s", needle, output)
		}
	}
}

func TestRunWithSessionIDRequestsAttach(t *testing.T) {
	result, err := Run([]string{"sess-123"})
	if err != nil {
		t.Fatalf("Run returned error: %v", err)
	}
	if result.Action != "attach-session" || result.SessionID != "sess-123" {
		t.Fatalf("unexpected result: %#v", result)
	}
}

func TestRunRejectsMultipleArgs(t *testing.T) {
	_, err := Run([]string{"sess-123", "extra"})
	if err == nil || !strings.Contains(err.Error(), "usage: claude-code-go assistant [sessionId]") {
		t.Fatalf("expected usage error, got %v", err)
	}
}
