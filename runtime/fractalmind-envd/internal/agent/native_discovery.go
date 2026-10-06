package agent

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"time"
)

// NativeInventory names in-process file agents for this envd process lifetime.
// It is ephemeral; a new process birth must never reuse the old instance ID.
// Bindings are physical configuration, not authority to execute a task.
type NativeInventory struct {
	pid           int
	birth         string
	bindings      []Instance
	workspacePins map[string]os.FileInfo
}

func NewNativeInventory(workspaces map[string]string) (*NativeInventory, map[string]string, error) {
	return newNativeInventory(workspaces, os.Getpid(), processBirth)
}

func newNativeInventory(workspaces map[string]string, pid int, birth func(int) (string, error)) (*NativeInventory, map[string]string, error) {
	n := &NativeInventory{pid: pid, workspacePins: map[string]os.FileInfo{}}
	aliases := map[string]string{}
	var err error
	n.birth, err = birth(pid)
	if err != nil || n.birth == "" {
		return n, aliases, nil // unsupported/unavailable continuity cannot claim an instance
	}
	if len(workspaces) > 1000 {
		return nil, nil, fmt.Errorf("too many native bindings")
	}
	for name, configured := range workspaces {
		if name == "" || !safeText(name, 256) {
			return nil, nil, fmt.Errorf("invalid native binding name")
		}
		path, err := filepath.EvalSymlinks(configured)
		if err != nil || !filepath.IsAbs(path) || !safeText(path, 4096) {
			return nil, nil, fmt.Errorf("native binding requires an existing absolute workspace")
		}
		info, err := os.Stat(path)
		if err != nil || !info.IsDir() {
			return nil, nil, fmt.Errorf("native workspace is not a directory")
		}
		identity, _ := json.Marshal([]string{"FM-NATIVE-FILE-INSTANCE:1", strconv.Itoa(pid), n.birth, name})
		hash := sha256.Sum256(identity)
		id := "native-" + hex.EncodeToString(hash[:])
		ws := sha256.Sum256([]byte(path))
		n.bindings = append(n.bindings, Instance{InstanceID: id, Session: name, State: "observed", Runtime: "bounded-process-v1", Continuity: "envd-process-v1", Workspace: path, WorkspaceHash: hex.EncodeToString(ws[:])})
		aliases[id] = path // canonical pin; changing a config symlink cannot retarget execution
		n.workspacePins[id] = info
	}
	sort.Slice(n.bindings, func(i, j int) bool { return n.bindings[i].InstanceID < n.bindings[j].InstanceID })
	return n, aliases, nil
}

func (n *NativeInventory) Discover() Discovery { return n.discover(processBirth) }

// WorkspaceIdentity pins an opened tool root to the originally bound directory.
func (n *NativeInventory) WorkspaceIdentity(instanceID string) os.FileInfo {
	return n.workspacePins[instanceID]
}
func (n *NativeInventory) discover(birth func(int) (string, error)) Discovery {
	d := Discovery{Format: 1, State: "unavailable", ObservedAt: time.Now(), Instances: []Instance{}}
	if !supportsProcessBirth {
		d.State = "unsupported"
		return d
	}
	current, err := birth(n.pid)
	if err != nil || current == "" || current != n.birth {
		return d
	}
	for _, pin := range n.bindings {
		path, err := filepath.EvalSymlinks(pin.Workspace)
		info, statErr := os.Stat(pin.Workspace)
		if err != nil || statErr != nil || !info.IsDir() || path != pin.Workspace || !os.SameFile(info, n.workspacePins[pin.InstanceID]) {
			d.Instances = []Instance{}
			return d // no renewal of a disappeared or redirected workspace
		}
		d.Instances = append(d.Instances, pin)
	}
	current, err = birth(n.pid)
	if err != nil || current != n.birth {
		d.Instances = []Instance{}
		return d
	}
	d.State = "complete"
	d.ObservedAt = time.Now()
	return d
}

// Native discovery is a separate signed source, never a tmux capability upgrade.
func ValidateNativeDiscovery(d *Discovery, heartbeatAt time.Time) error {
	if d == nil {
		return nil
	}
	if d.Format != 1 || d.ObservedAt.IsZero() || d.ObservedAt.After(heartbeatAt.Add(5*time.Second)) || len(d.Instances) > 1000 || (d.State != "complete" && d.State != "unavailable" && d.State != "unsupported") || (d.State != "complete" && len(d.Instances) != 0) {
		return fmt.Errorf("invalid native discovery")
	}
	seen := map[string]bool{}
	for _, r := range d.Instances {
		ws := sha256.Sum256([]byte(r.Workspace))
		if r.Runtime != "bounded-process-v1" || r.Continuity != "envd-process-v1" || r.State != "observed" || r.Pane != "" || r.Session == "" || !safeText(r.Session, 256) || !safeText(r.Workspace, 4096) || !filepath.IsAbs(r.Workspace) || r.WorkspaceHash != hex.EncodeToString(ws[:]) || len(r.InstanceID) != 71 || r.InstanceID[:7] != "native-" || !hashPattern.MatchString(r.InstanceID[7:]) || seen[r.InstanceID] {
			return fmt.Errorf("invalid native instance")
		}
		seen[r.InstanceID] = true
	}
	return nil
}
