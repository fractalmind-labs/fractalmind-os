package update

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestBuildResultWithSourceURL(t *testing.T) {
	t.Parallel()

	sourceBytes := []byte("remote-binary-v1")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/claude-code-go" {
			http.NotFound(w, r)
			return
		}
		_, _ = w.Write(sourceBytes)
	}))
	defer server.Close()

	target := filepath.Join(t.TempDir(), "bin", "claude-code-go")
	sourceURL := server.URL + "/claude-code-go"

	checkOnly, err := BuildResult(Options{
		TargetArg: target,
		SourceURL: sourceURL,
	})
	if err != nil {
		t.Fatalf("check-only failed: %v", err)
	}
	if checkOnly.CheckStatus != "update-available" {
		t.Fatalf("expected update-available, got %q", checkOnly.CheckStatus)
	}
	if checkOnly.CurrentVersion != "missing" {
		t.Fatalf("expected missing current version, got %q", checkOnly.CurrentVersion)
	}
	if checkOnly.SourceURL != sourceURL {
		t.Fatalf("expected source url %q, got %q", sourceURL, checkOnly.SourceURL)
	}

	applied, err := BuildResult(Options{
		TargetArg: target,
		SourceURL: sourceURL,
		Apply:     true,
	})
	if err != nil {
		t.Fatalf("apply failed: %v", err)
	}
	if !applied.Applied {
		t.Fatalf("expected apply result to be true")
	}

	gotBytes, err := os.ReadFile(target)
	if err != nil {
		t.Fatalf("read target: %v", err)
	}
	if string(gotBytes) != string(sourceBytes) {
		t.Fatalf("target bytes mismatch: got %q want %q", string(gotBytes), string(sourceBytes))
	}

	recheck, err := BuildResult(Options{
		TargetArg: target,
		SourceURL: sourceURL,
	})
	if err != nil {
		t.Fatalf("re-check failed: %v", err)
	}
	if recheck.CheckStatus != "up-to-date" {
		t.Fatalf("expected up-to-date, got %q", recheck.CheckStatus)
	}
}
