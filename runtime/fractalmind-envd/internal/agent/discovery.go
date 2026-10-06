package agent

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

// Discovery is an ephemeral inventory, never independent Agent identity or
// execution authority. ObservedAt belongs to the scan, not the later heartbeat.
type Discovery struct {
	Format     int        `json:"format"`
	State      string     `json:"state"` // complete, unavailable, unsupported
	ObservedAt time.Time  `json:"observed_at"`
	Instances  []Instance `json:"instances"`
}
type Instance struct {
	InstanceID    string `json:"instance_id"`
	Session       string `json:"session"`
	Pane          string `json:"pane"`
	State         string `json:"state"` // observed, unverified, dead
	Runtime       string `json:"runtime"`
	Continuity    string `json:"continuity"`
	Workspace     string `json:"workspace"`
	WorkspaceHash string `json:"workspace_hash"`
}

const discoveryFormat = "#{pid}\t#{session_name}\t#{pane_id}\t#{pane_pid}\t#{pane_dead}\t#{pane_current_path}"

var panePattern = regexp.MustCompile(`^%[0-9]+$`)
var hashPattern = regexp.MustCompile(`^[0-9a-f]{64}$`)

// readTmux is bounded even if the local server is stuck or has enormous output.
func readTmux(ctx context.Context, socket string) ([]byte, error) {
	args := []string{"list-panes", "-a", "-F", discoveryFormat}
	if socket != "" {
		args = append([]string{"-S", socket}, args...)
	}
	cmd := exec.CommandContext(ctx, "tmux", args...)
	var out limitedOutput
	cmd.Stdout = &out
	cmd.Stderr = io.Discard
	err := cmd.Run()
	// Exit 1 can mean no server, permission denied or a bad socket. It must not
	// be silently reported as a completed empty scan.
	return out.Bytes(), err
}

type limitedOutput struct{ bytes.Buffer }

func (b *limitedOutput) Write(p []byte) (int, error) {
	if b.Len()+len(p) > 256<<10 {
		return 0, fmt.Errorf("inventory exceeds limit")
	}
	return b.Buffer.Write(p)
}
func safeText(s string, limit int) bool {
	if len(s) > limit || !utf8.ValidString(s) {
		return false
	}
	for _, r := range s {
		if r < 32 || r == 127 {
			return false
		}
	}
	return true
}

// Discover reads existing panes twice and checks OS process birth identities on
// both sides. No tmux option, process, task or on-disk registry is changed.
func (s *Scanner) Discover() Discovery {
	return discover(s.method, func(ctx context.Context) ([]byte, error) { return readTmux(ctx, s.tmuxSocket) }, processBirth)
}
func discover(method string, read func(context.Context) ([]byte, error), birth func(int) (string, error)) Discovery {
	d := Discovery{Format: 1, State: "unavailable", ObservedAt: time.Now(), Instances: []Instance{}}
	if method != "tmux" || !supportsProcessBirth {
		d.State = "unsupported"
		return d
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	raw, err := read(ctx)
	if err != nil {
		return d
	}
	pins := map[int]string{}
	seen := map[string]bool{}
	rows := []Instance{}
	lines := strings.Split(strings.TrimSuffix(string(raw), "\n"), "\n")
	for _, line := range lines {
		if line == "" {
			continue
		}
		fields := strings.Split(line, "\t")
		if len(fields) != 6 {
			return d
		}
		if !isAgentSession(fields[1]) {
			continue
		}
		if !safeText(fields[1], 256) || len(fields[2]) > 64 || !panePattern.MatchString(fields[2]) || (fields[4] != "0" && fields[4] != "1") || !safeText(fields[5], 4096) {
			return d
		}
		server, e1 := strconv.Atoi(fields[0])
		pid, e2 := strconv.Atoi(fields[3])
		if e1 != nil || e2 != nil || server < 1 || pid < 1 {
			return d
		}
		if seen[fields[2]] {
			continue
		}
		seen[fields[2]] = true
		if len(rows) >= 1000 {
			return d
		}
		r := Instance{Session: fields[1], Pane: fields[2], State: "unverified", Runtime: "tmux-observe", Continuity: "unverified"}
		if fields[4] == "1" {
			r.State = "dead"
			rows = append(rows, r)
			continue
		}
		path, err := filepath.EvalSymlinks(fields[5])
		info, statErr := os.Stat(path)
		if err != nil || statErr != nil || !info.IsDir() || !filepath.IsAbs(path) || !safeText(path, 4096) {
			rows = append(rows, r)
			continue
		}
		serverBorn, se := birth(server)
		paneBorn, pe := birth(pid)
		if se != nil || pe != nil || serverBorn == "" || paneBorn == "" {
			rows = append(rows, r)
			continue
		}
		for p, b := range map[int]string{server: serverBorn, pid: paneBorn} {
			if old, ok := pins[p]; ok && old != b {
				return d
			}
			pins[p] = b
		}
		// The Host address supplies the outer namespace. Names, active pane and
		// workspace changes cannot accidentally create another identity.
		identity, _ := json.Marshal([]string{"FM-TMUX-INSTANCE:1", strconv.Itoa(server), serverBorn, fields[2], strconv.Itoa(pid), paneBorn})
		sum := sha256.Sum256(identity)
		r.InstanceID = "tmux-" + hex.EncodeToString(sum[:])
		r.State = "observed"
		r.Continuity = "kernel-process-v1"
		r.Workspace = path
		ws := sha256.Sum256([]byte(path))
		r.WorkspaceHash = hex.EncodeToString(ws[:])
		rows = append(rows, r)
	}
	after, err := read(ctx)
	if err != nil || !bytes.Equal(raw, after) {
		return d
	}
	for pid, pin := range pins {
		current, err := birth(pid)
		if err != nil || current != pin {
			return d
		}
	}
	sort.Slice(rows, func(i, j int) bool { return rows[i].Pane < rows[j].Pane })
	d.State = "complete"
	d.ObservedAt = time.Now()
	d.Instances = rows
	return d
}

// ValidateDiscovery checks the signed wire schema; it does not validate a remote
// kernel, independent Agent key, or bounded adapter capability.
func ValidateDiscovery(d *Discovery, heartbeatAt time.Time) error {
	if d == nil {
		return nil
	}
	if d.Format != 1 || d.ObservedAt.IsZero() || d.ObservedAt.After(heartbeatAt.Add(5*time.Second)) || len(d.Instances) > 1000 {
		return fmt.Errorf("invalid discovery snapshot")
	}
	if d.State != "complete" && d.State != "unavailable" && d.State != "unsupported" {
		return fmt.Errorf("invalid discovery state")
	}
	if d.State != "complete" && len(d.Instances) != 0 {
		return fmt.Errorf("failed discovery has instances")
	}
	seen := map[string]bool{}
	panes := map[string]bool{}
	for _, r := range d.Instances {
		if r.Runtime != "tmux-observe" || !safeText(r.Session, 256) || r.Session == "" || len(r.Pane) > 64 || !panePattern.MatchString(r.Pane) || panes[r.Pane] || !safeText(r.Workspace, 4096) {
			return fmt.Errorf("invalid discovery instance")
		}
		panes[r.Pane] = true
		if r.State == "observed" {
			if r.Continuity != "kernel-process-v1" || !strings.HasPrefix(r.InstanceID, "tmux-") || !hashPattern.MatchString(strings.TrimPrefix(r.InstanceID, "tmux-")) || !hashPattern.MatchString(r.WorkspaceHash) || r.Workspace == "" || seen[r.InstanceID] {
				return fmt.Errorf("invalid instance continuity")
			}
			ws := sha256.Sum256([]byte(r.Workspace))
			if r.WorkspaceHash != hex.EncodeToString(ws[:]) {
				return fmt.Errorf("invalid workspace hash")
			}
			seen[r.InstanceID] = true
		} else if (r.State != "unverified" && r.State != "dead") || r.Continuity != "unverified" || r.InstanceID != "" || r.Workspace != "" || r.WorkspaceHash != "" {
			return fmt.Errorf("unverified instance claims continuity")
		}
	}
	return nil
}
