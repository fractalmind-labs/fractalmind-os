//go:build linux || darwin

package boundedrun

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"syscall"
	"testing"
	"time"
)

func TestSymlinkAndHardlinkCannotReadOrModifyOutsideFiles(t *testing.T) {
	outside := t.TempDir()
	secret := filepath.Join(outside, "secret")
	if err := os.WriteFile(secret, []byte("outside"), 0600); err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	if err := os.Symlink(outside, filepath.Join(dir, "outside")); err != nil {
		t.Fatal(err)
	}
	if err := os.Link(secret, filepath.Join(dir, "hardlink")); err != nil {
		t.Fatal(err)
	}
	tools := openTestTools(t, dir, 10, permit)
	for i, name := range []string{"outside/secret", "hardlink"} {
		for j, action := range []string{Read, Write} {
			if _, err := tools.Call(context.Background(), Call{ID: fmt.Sprintf("%d-%d", i, j), Action: action, Path: name}); err == nil {
				t.Fatalf("outside %s accepted %s", name, action)
			}
		}
	}
	actual, err := os.ReadFile(secret)
	if err != nil || string(actual) != "outside" {
		t.Fatal("outside file changed")
	}
}
func TestSymlinkCannotCrossAnActionScopeInsideWorkspace(t *testing.T) {
	dir := t.TempDir()
	for _, subdir := range []string{"src", "private"} {
		if err := os.Mkdir(filepath.Join(dir, subdir), 0700); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(dir, "private", "secret"), []byte("private"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink("../private", filepath.Join(dir, "src", "escape")); err != nil {
		t.Fatal(err)
	}
	tools, err := OpenTools(Policy{Workspace: dir, Paths: map[string][]string{Read: {"src"}, Write: {"src"}}, MaxCalls: 5, Deadline: time.Now().Add(time.Minute)}, permit)
	if err != nil {
		t.Fatal(err)
	}
	defer tools.Close()
	for _, action := range []string{Read, Write} {
		if _, err := tools.Call(context.Background(), Call{ID: action, Action: action, Path: "src/escape/secret"}); err == nil {
			t.Fatal("symlink crossed allowed action root")
		}
	}
}
func TestFIFOReadDoesNotBlockOrPretendToBeAFile(t *testing.T) {
	dir := t.TempDir()
	if err := syscall.Mkfifo(filepath.Join(dir, "fifo"), 0600); err != nil {
		t.Fatal(err)
	}
	tools := openTestTools(t, dir, 2, permit)
	start := time.Now()
	if _, err := tools.Call(context.Background(), Call{ID: "fifo", Action: Read, Path: "fifo"}); err == nil {
		t.Fatal("FIFO accepted")
	}
	if time.Since(start) > time.Second {
		t.Fatal("FIFO blocked the Agent loop")
	}
}
