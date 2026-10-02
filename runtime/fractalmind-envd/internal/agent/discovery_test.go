package agent

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"
)

func TestDiscoveryFailsClosedAcrossRacesAndUnverifiedProcesses(t *testing.T) {
	if !supportsProcessBirth {
		t.Skip("tmux continuity unsupported on this OS")
	}
	workspace := t.TempDir()
	base := "123\tagent-existing\t%1\t456\t0\t" + workspace + "\n"
	for _, mode := range []string{"valid", "birth-unavailable", "birth-changed", "metadata-changed", "read-failed", "malformed", "dead", "workspace-missing", "duplicate-pane"} {
		t.Run(mode, func(t *testing.T) {
			reads, births := 0, 0
			d := discover("tmux", func(context.Context) ([]byte, error) {
				reads++
				value := base
				if mode == "read-failed" {
					return nil, fmt.Errorf("unavailable")
				}
				if mode == "metadata-changed" && reads > 1 {
					value = strings.Replace(value, "agent-existing", "agent-new", 1)
				}
				if mode == "malformed" {
					value = "invalid\n"
				}
				if mode == "dead" {
					value = strings.Replace(value, "\t0\t", "\t1\t", 1)
				}
				if mode == "workspace-missing" {
					value = strings.Replace(value, workspace, workspace+"/missing", 1)
				}
				if mode == "duplicate-pane" {
					value += base
				}
				return []byte(value), nil
			}, func(pid int) (string, error) {
				births++
				if mode == "birth-unavailable" {
					return "", fmt.Errorf("no process")
				}
				if mode == "birth-changed" && births > 2 {
					return "changed", nil
				}
				return fmt.Sprintf("boot:%d:birth", pid), nil
			})
			if mode == "read-failed" || mode == "malformed" || mode == "metadata-changed" || mode == "birth-changed" {
				if d.State != "unavailable" || len(d.Instances) != 0 {
					t.Fatalf("failure retained inventory: %+v", d)
				}
				return
			}
			if d.State != "complete" || len(d.Instances) != 1 {
				t.Fatalf("bad discovery %+v", d)
			}
			if mode == "birth-unavailable" || mode == "workspace-missing" || mode == "dead" {
				if d.Instances[0].InstanceID != "" || d.Instances[0].Continuity != "unverified" {
					t.Fatalf("unproven instance promoted: %+v", d)
				}
			} else if d.Instances[0].State != "observed" {
				t.Fatalf("not observed: %+v", d)
			}
			if err := ValidateDiscovery(&d, time.Now()); err != nil {
				t.Fatal(err)
			}
		})
	}
}

// Real tmux + native kernel reads; never uses or modifies the user's server.
func TestTmuxDiscoveryContinuityLifecycle(t *testing.T) {
	if !supportsProcessBirth {
		t.Skip("tmux continuity unsupported on this OS")
	}
	binary, err := exec.LookPath("tmux")
	if err != nil {
		t.Skip("tmux not installed")
	}
	dir := t.TempDir()
	dir, err = filepath.EvalSymlinks(dir)
	if err != nil {
		t.Fatal(err)
	}
	// Unix socket paths are capped at roughly 100 bytes on macOS.
	socketDir, err := os.MkdirTemp("/tmp", "fm-tmux-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(socketDir) })
	socket := filepath.Join(socketDir, "tmux.sock")
	run := func(args ...string) []byte {
		t.Helper()
		all := append([]string{"-S", socket, "-f", "/dev/null"}, args...)
		out, err := exec.Command(binary, all...).CombinedOutput()
		if err != nil {
			t.Fatalf("private tmux %v: %v %s", args, err, out)
		}
		return out
	}
	t.Cleanup(func() { _ = exec.Command(binary, "-S", socket, "kill-server").Run() })
	run("new-session", "-d", "-s", "keeper", "-c", dir, "sleep 300")
	run("new-session", "-d", "-s", "agent-original", "-c", dir, "sleep 300")
	read := func(ctx context.Context) ([]byte, error) {
		return exec.CommandContext(ctx, binary, "-S", socket, "list-panes", "-a", "-F", discoveryFormat).Output()
	}
	scan := func() Discovery {
		t.Helper()
		d := discover("tmux", read, processBirth)
		if d.State != "complete" {
			t.Fatalf("scan unavailable: %+v", d)
		}
		return d
	}
	first := scan()
	if len(first.Instances) != 1 || first.Instances[0].State != "observed" {
		t.Fatalf("missing real pane: %+v", first)
	}
	old := first.Instances[0]
	if old.Workspace != dir || old.WorkspaceHash == "" {
		t.Fatalf("wrong workspace: %+v", old)
	}
	// A fresh discovery has no registry or previous in-memory identity map.
	again := scan()
	if again.Instances[0].InstanceID != old.InstanceID {
		t.Fatal("identity changed between scans")
	}
	run("rename-session", "-t", "agent-original", "agent-renamed")
	renamed := scan()
	if renamed.Instances[0].InstanceID != old.InstanceID || renamed.Instances[0].Session != "agent-renamed" {
		t.Fatal("rename changed continuity")
	}
	run("split-window", "-d", "-t", "agent-renamed", "-c", dir, "sleep 300")
	multiple := scan()
	if len(multiple.Instances) != 2 || multiple.Instances[0].InstanceID == multiple.Instances[1].InstanceID {
		t.Fatal("multiple panes merged")
	}
	run("respawn-pane", "-k", "-t", old.Pane, "sleep 300")
	restarted := scan()
	for _, r := range restarted.Instances {
		if r.Pane == old.Pane && r.InstanceID == old.InstanceID {
			t.Fatal("respawn reused old identity")
		}
	}
	run("kill-session", "-t", "agent-renamed")
	missing := scan()
	if len(missing.Instances) != 0 {
		t.Fatal("vanished pane retained")
	}
	wire, err := json.Marshal(missing)
	if err != nil || !strings.Contains(string(wire), `"instances":[]`) {
		t.Fatal("empty inventory is not an explicit JSON array", string(wire), err)
	}
	run("new-session", "-d", "-s", "agent-renamed", "-c", dir, "sleep 300")
	recreated := scan()
	if recreated.Instances[0].InstanceID == old.InstanceID {
		t.Fatal("same name recovered old instance")
	}
	if _, err := os.Stat(filepath.Join(dir, "registry")); !os.IsNotExist(err) {
		t.Fatal("unexpected local business persistence")
	}
	t.Log("real tmux: rescan and rename preserve identity; split, respawn, disappearance and same-name recreation are distinguished")
}

func TestDiscoverySchemaRejectsFalseAuthority(t *testing.T) {
	d := Discovery{Format: 1, State: "unavailable", ObservedAt: time.Now(), Instances: []Instance{}}
	for _, mutate := range []func(*Discovery){
		func(d *Discovery) { d.State = "online" },
		func(d *Discovery) { d.ObservedAt = time.Now().Add(time.Minute) },
		func(d *Discovery) { d.Instances = []Instance{{Runtime: "bounded-process-v1"}} },
	} {
		copy := d
		mutate(&copy)
		if reflect.DeepEqual(copy, d) || ValidateDiscovery(&copy, time.Now()) == nil {
			t.Fatal("bad schema accepted")
		}
	}
}
