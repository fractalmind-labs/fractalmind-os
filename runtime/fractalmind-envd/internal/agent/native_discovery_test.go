package agent

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestNativeDiscoveryPinsProcessAndWorkspace(t *testing.T) {
	if !supportsProcessBirth {
		t.Skip("native continuity not supported")
	}
	root := t.TempDir()
	workspace := filepath.Join(root, "work")
	if err := os.Mkdir(workspace, 0700); err != nil {
		t.Fatal(err)
	}
	birth := func(int) (string, error) { return "boot:original:birth", nil }
	n, aliases, err := newNativeInventory(map[string]string{"files": workspace}, 123, birth)
	if err != nil {
		t.Fatal(err)
	}
	d := n.discover(birth)
	if d.State != "complete" || len(d.Instances) != 1 {
		t.Fatalf("invalid inventory %+v", d)
	}
	r := d.Instances[0]
	if aliases[r.InstanceID] != r.Workspace || r.Pane != "" || r.Runtime != "bounded-process-v1" {
		t.Fatal("incorrect native binding")
	}
	if err := ValidateNativeDiscovery(&d, time.Now()); err != nil {
		t.Fatal(err)
	}
	if err := ValidateDiscovery(&d, time.Now()); err == nil {
		t.Fatal("native promoted through tmux source")
	}
	changed := func(int) (string, error) { return "boot:new:birth", nil }
	if got := n.discover(changed); got.State != "unavailable" || len(got.Instances) != 0 {
		t.Fatal("old process revived")
	}
	next, _, err := newNativeInventory(map[string]string{"files": workspace}, 123, changed)
	if err != nil {
		t.Fatal(err)
	}
	if next.discover(changed).Instances[0].InstanceID == r.InstanceID {
		t.Fatal("PID reuse merged process lifetimes")
	}
	if err := os.Rename(workspace, workspace+"-old"); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(workspace, 0700); err != nil {
		t.Fatal(err)
	}
	if got := n.discover(birth); got.State != "unavailable" || len(got.Instances) != 0 {
		t.Fatal("replacement directory trusted")
	}
}

func TestNativeDiscoveryReadsActualKernelAndDoesNotRetargetSymlink(t *testing.T) {
	if !supportsProcessBirth {
		t.Skip("native continuity not supported")
	}
	root := t.TempDir()
	link := filepath.Join(root, "binding")
	a, b := filepath.Join(root, "a"), filepath.Join(root, "b")
	for _, p := range []string{a, b} {
		if err := os.Mkdir(p, 0700); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.Symlink(a, link); err != nil {
		t.Fatal(err)
	}
	n, aliases, err := NewNativeInventory(map[string]string{"file-agent": link})
	if err != nil {
		t.Fatal(err)
	}
	d := n.Discover()
	if d.State != "complete" || len(d.Instances) != 1 {
		t.Fatalf("actual kernel continuity unavailable %+v", d)
	}
	actual, err := filepath.EvalSymlinks(a)
	if err != nil {
		t.Fatal(err)
	}
	r := d.Instances[0]
	if aliases[r.InstanceID] != actual {
		t.Fatal("alias not canonical")
	}
	if err := os.Remove(link); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(b, link); err != nil {
		t.Fatal(err)
	}
	if got := n.Discover(); got.State != "complete" || got.Instances[0].Workspace != actual {
		t.Fatal("configuration symlink retargeted pinned instance")
	}
}

func TestNativeDiscoveryRejectsWireCapabilitySubstitution(t *testing.T) {
	if !supportsProcessBirth {
		t.Skip("native continuity not supported")
	}
	birth := func(int) (string, error) { return "boot:birth", nil }
	n, _, err := newNativeInventory(map[string]string{"files": t.TempDir()}, 123, birth)
	if err != nil {
		t.Fatal(err)
	}
	d := n.discover(birth)
	for _, mutate := range []func(*Instance){func(r *Instance) { r.Pane = "%1" }, func(r *Instance) { r.Continuity = "kernel-process-v1" }, func(r *Instance) { r.Runtime = "tmux-observe" }, func(r *Instance) { r.InstanceID = "files" }, func(r *Instance) { r.WorkspaceHash = "" }} {
		copy := d
		copy.Instances = append([]Instance{}, d.Instances...)
		mutate(&copy.Instances[0])
		if ValidateNativeDiscovery(&copy, time.Now()) == nil {
			t.Fatal("substituted native schema accepted")
		}
	}
}
