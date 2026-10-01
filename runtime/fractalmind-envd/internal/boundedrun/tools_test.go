package boundedrun

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func openTestTools(t *testing.T, dir string, max uint64, check Check) *Tools {
	t.Helper()
	tools, err := OpenTools(Policy{Workspace: dir, Paths: map[string][]string{Read: {"."}, Write: {"."}, List: {"."}}, MaxCalls: max, Deadline: time.Now().Add(time.Minute)}, check)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { tools.Close() })
	return tools
}
func permit(context.Context) error { return nil }
func TestRealWorkspaceCreateReadEditAndIdempotency(t *testing.T) {
	dir := t.TempDir()
	tools := openTestTools(t, dir, 4, permit)
	ctx := context.Background()
	create := Call{ID: "create", Action: Write, Path: "docs/README.md", Content: "目标：自主验证\n"}
	first, err := tools.Call(ctx, create)
	if err != nil || first.Hash == "" || first.Used != 1 {
		t.Fatalf("create: %+v %v", first, err)
	}
	duplicate, err := tools.Call(ctx, create)
	if err != nil || duplicate.Hash != first.Hash || duplicate.Used != 1 || tools.Used() != 1 {
		t.Fatal("duplicate repeated write")
	}
	changed := create
	changed.Content = "different"
	if _, err := tools.Call(ctx, changed); !errors.Is(err, ErrConflict) {
		t.Fatal("same ID different intent accepted")
	}
	read, err := tools.Call(ctx, Call{ID: "read", Action: Read, Path: create.Path})
	if err != nil || read.Content != create.Content || read.Hash != first.Hash {
		t.Fatalf("read: %+v %v", read, err)
	}
	if _, err := tools.Call(ctx, Call{ID: "blind", Action: Write, Path: create.Path, Content: "overwrite"}); !errors.Is(err, ErrConflict) {
		t.Fatal("blind overwrite accepted")
	}
	if _, err := tools.Call(ctx, Call{ID: "edit", Action: Write, Path: create.Path, Content: "已完成\n", ExpectedHash: read.Hash}); err != nil {
		t.Fatal(err)
	}
	if _, err := tools.Call(ctx, Call{ID: "limit", Action: List, Path: "."}); !errors.Is(err, ErrBudget) {
		t.Fatal("budget exceeded")
	}
	actual, err := os.ReadFile(filepath.Join(dir, create.Path))
	if err != nil || string(actual) != "已完成\n" {
		t.Fatal("actual file not changed")
	}
}
func TestScopeActionAndControlMetadataCannotBeEscaped(t *testing.T) {
	dir := t.TempDir()
	tools := openTestTools(t, dir, 50, permit)
	for i, name := range []string{"../outside", "src/../../outside", "/tmp/outside", "C:/outside", "src\\outside", "src//outside", ".git/config", "src/.claude/settings.json", ".codex/config", ".agents/key", ".fractalmind-write-stolen", ".GIT/config", "src/.ClAuDe/settings.json", ".CODEX/config", ".AGENTS/key", ".FRACTALMIND-WRITE-stolen", "src/CLAUDE~1/config", "src/.claude./config", "src/.claude /config", "src/con.txt", "src/LPT1", "src/NUL"} {
		if _, err := tools.Call(context.Background(), Call{ID: fmt.Sprint(i), Action: Write, Path: name, Content: "no"}); !errors.Is(err, ErrBoundary) {
			t.Fatalf("unsafe path %q: %v", name, err)
		}
	}
	if _, err := tools.Call(context.Background(), Call{ID: "shell", Action: "shell", Path: "src"}); !errors.Is(err, ErrBoundary) {
		t.Fatal("unknown action accepted")
	}
	if tools.Used() != 0 {
		t.Fatal("rejected boundaries consumed tool budget")
	}
}
func TestAuthorityDeadlineAndStopBeforePublish(t *testing.T) {
	var checks int
	dir := t.TempDir()
	tools := openTestTools(t, dir, 5, func(context.Context) error {
		checks++
		if checks > 1 {
			return ErrStopped
		}
		return nil
	})
	if _, err := tools.Call(context.Background(), Call{ID: "write", Action: Write, Path: "result.md", Content: "must not publish"}); !errors.Is(err, ErrStopped) {
		t.Fatal(err)
	}
	entries, err := os.ReadDir(dir)
	if err != nil || len(entries) != 0 || tools.Used() != 1 {
		t.Fatal("stopped write published output or leaked temporary file")
	}
	tools.now = func() time.Time { return tools.policy.Deadline }
	if _, err := tools.Call(context.Background(), Call{ID: "expired", Action: List, Path: "."}); !errors.Is(err, ErrStopped) {
		t.Fatal("deadline equality accepted")
	}
	if checks != 2 || tools.Used() != 1 {
		t.Fatal("expired request reached authority/effect")
	}
}
func TestRevocationAlsoRejectsAnExactRetry(t *testing.T) {
	dir := t.TempDir()
	var revoked atomic.Bool
	tools := openTestTools(t, dir, 2, func(context.Context) error {
		if revoked.Load() {
			return ErrStopped
		}
		return nil
	})
	call := Call{ID: "list", Action: List, Path: "."}
	if _, err := tools.Call(context.Background(), call); err != nil {
		t.Fatal(err)
	}
	revoked.Store(true)
	if _, err := tools.Call(context.Background(), call); !errors.Is(err, ErrStopped) {
		t.Fatal("cached result bypassed revoked authority")
	}
	if tools.Used() != 1 {
		t.Fatal("rejected retry consumed budget")
	}
}
func TestConcurrentCallsCannotOversubscribeBudget(t *testing.T) {
	dir := t.TempDir()
	tools := openTestTools(t, dir, 3, permit)
	var succeeded atomic.Int32
	var wg sync.WaitGroup
	for i := 0; i < 32; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			_, err := tools.Call(context.Background(), Call{ID: fmt.Sprint(i), Action: Write, Path: fmt.Sprintf("result-%d", i), Content: "one"})
			if err == nil {
				succeeded.Add(1)
			} else if !errors.Is(err, ErrBudget) {
				t.Errorf("unexpected error: %v", err)
			}
		}(i)
	}
	wg.Wait()
	entries, err := os.ReadDir(dir)
	if err != nil || len(entries) != 3 || succeeded.Load() != 3 || tools.Used() != 3 {
		t.Fatal("concurrent calls exceeded three writes")
	}
}
func TestConcurrentExactRetriesWriteOnce(t *testing.T) {
	dir := t.TempDir()
	tools := openTestTools(t, dir, 1, permit)
	call := Call{ID: "same", Action: Write, Path: "result", Content: "once"}
	var wg sync.WaitGroup
	for i := 0; i < 16; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			result, err := tools.Call(context.Background(), call)
			if err != nil || result.Used != 1 {
				t.Errorf("retry: %v %+v", err, result)
			}
		}()
	}
	wg.Wait()
	if tools.Used() != 1 {
		t.Fatal("duplicate charged again")
	}
}
func TestCurrentFileHashRejectsConcurrentEditorChange(t *testing.T) {
	dir := t.TempDir()
	file := filepath.Join(dir, "notes.md")
	if err := os.WriteFile(file, []byte("old"), 0600); err != nil {
		t.Fatal(err)
	}
	tools := openTestTools(t, dir, 3, permit)
	read, err := tools.Call(context.Background(), Call{ID: "read", Action: Read, Path: "notes.md"})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(file, []byte("human edit"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := tools.Call(context.Background(), Call{ID: "edit", Action: Write, Path: "notes.md", Content: "agent edit", ExpectedHash: read.Hash}); !errors.Is(err, ErrConflict) {
		t.Fatal("stale expected hash overwritten")
	}
	actual, err := os.ReadFile(file)
	if err != nil || string(actual) != "human edit" {
		t.Fatal("human edit lost")
	}
}
func TestInputAndReadOutputAreBounded(t *testing.T) {
	dir := t.TempDir()
	tools := openTestTools(t, dir, 5, permit)
	if _, err := tools.Call(context.Background(), Call{ID: "huge", Action: Write, Path: "huge", Content: strings.Repeat("x", MaxFileBytes+1)}); !errors.Is(err, ErrBoundary) {
		t.Fatal("large tool input accepted")
	}
	if err := os.WriteFile(filepath.Join(dir, "huge"), []byte(strings.Repeat("x", MaxFileBytes+1)), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := tools.Call(context.Background(), Call{ID: "huge-read", Action: Read, Path: "huge"}); !errors.Is(err, ErrBoundary) {
		t.Fatal("large tool output accepted")
	}
	if err := os.WriteFile(filepath.Join(dir, "binary"), []byte{255}, 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := tools.Call(context.Background(), Call{ID: "binary", Action: Read, Path: "binary"}); !errors.Is(err, ErrBoundary) {
		t.Fatal("invalid UTF-8 converted silently")
	}
}
func TestPolicyIsCopiedAndDirectoryListDoesNotExposeControlFolders(t *testing.T) {
	dir := t.TempDir()
	for _, name := range []string{".git", ".claude", "src"} {
		if err := os.Mkdir(filepath.Join(dir, name), 0700); err != nil {
			t.Fatal(err)
		}
	}
	policy := Policy{Workspace: dir, Paths: map[string][]string{List: {"src"}}, MaxCalls: 2, Deadline: time.Now().Add(time.Minute)}
	tools, err := OpenTools(policy, permit)
	if err != nil {
		t.Fatal(err)
	}
	defer tools.Close()
	policy.Paths[List][0] = "."
	if _, err := tools.Call(context.Background(), Call{ID: "outside", Action: List, Path: "."}); !errors.Is(err, ErrBoundary) {
		t.Fatal("caller mutation expanded policy")
	}
	all := openTestTools(t, dir, 2, permit)
	listing, err := all.Call(context.Background(), Call{ID: "list", Action: List, Path: "."})
	if err != nil || len(listing.Entries) != 1 || listing.Entries[0] != "src" {
		t.Fatalf("control folders leaked: %+v %v", listing, err)
	}
	listing.Entries[0] = "mutated"
	again, err := all.Call(context.Background(), Call{ID: "list", Action: List, Path: "."})
	if err != nil || again.Entries[0] != "src" {
		t.Fatal("caller mutated cached result")
	}
}
