// Package boundedrun implements the tools of the constrained Agent runtime.
// A planner proposes data; it never receives a shell, host keys or filesystem
// handles. Every accepted tool call is checked again by the execution host.
package boundedrun

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

const (
	Read         = "file.read"
	Write        = "file.write"
	List         = "file.list"
	MaxFileBytes = 16 << 10
	MaxEntries   = 256
)

var ErrBoundary = errors.New("tool request exceeds the execution boundary")
var ErrBudget = errors.New("tool-call budget exhausted")
var ErrStopped = errors.New("execution stopped or expired")
var ErrConflict = errors.New("workspace file changed")

type Policy struct {
	// The local workspace binding must match the chain ManagedAgent record.
	Workspace string
	// Optional physical pin supplied by the native instance inventory. Check the
	// opened handle itself, closing the gap between a path check and OpenRoot.
	WorkspaceIdentity os.FileInfo
	// Paths are existing directory roots relative to Workspace, per action.
	// Each gets its own os.Root handle, so a symlink cannot cross into another
	// directory inside Workspace that the action was not authorized to access.
	Paths    map[string][]string
	Deadline time.Time
	MaxCalls uint64
}
type Call struct {
	ID      string `json:"id"`
	Action  string `json:"action"`
	Path    string `json:"path"`
	Content string `json:"content,omitempty"`
	// Empty means create only; a nonempty hash must match the current contents.
	ExpectedHash string `json:"expected_hash,omitempty"`
}
type Result struct {
	ID         string    `json:"id"`
	Action     string    `json:"action"`
	Path       string    `json:"path"`
	Content    string    `json:"content,omitempty"`
	Hash       string    `json:"hash,omitempty"`
	Entries    []string  `json:"entries,omitempty"`
	Truncated  bool      `json:"truncated,omitempty"`
	Used       uint64    `json:"used"`
	ObservedAt time.Time `json:"observed_at"`
}
type Check func(context.Context) error
type cachedCall struct {
	fingerprint [32]byte
	result      Result
	err         error
}
type scopedRoot struct {
	prefix string
	root   *os.Root
}
type Tools struct {
	mu        sync.Mutex
	roots     map[string][]scopedRoot
	policy    Policy
	check     Check
	now       func() time.Time
	used      uint64
	completed map[string]cachedCall
	closed    bool
}

func OpenTools(policy Policy, check Check) (*Tools, error) {
	if check == nil || policy.MaxCalls == 0 || policy.MaxCalls > 1000 || policy.Deadline.IsZero() || !time.Now().Before(policy.Deadline) {
		return nil, fmt.Errorf("current authority, finite deadline and 1–1000 tool calls are required")
	}
	paths := make(map[string][]string, len(policy.Paths))
	for action, allowed := range policy.Paths {
		if action != Read && action != Write && action != List {
			return nil, ErrBoundary
		}
		if len(allowed) == 0 {
			return nil, ErrBoundary
		}
		for _, prefix := range allowed {
			if !validPath(prefix, true) {
				return nil, ErrBoundary
			}
		}
		paths[action] = append([]string(nil), allowed...)
	}
	if len(paths) == 0 {
		return nil, ErrBoundary
	}
	policy.Paths = paths
	root, err := os.OpenRoot(policy.Workspace)
	if err != nil {
		return nil, err
	}
	defer root.Close()
	if policy.WorkspaceIdentity != nil {
		info, err := root.Stat(".")
		if err != nil || !os.SameFile(info, policy.WorkspaceIdentity) {
			return nil, ErrConflict
		}
	}
	roots := make(map[string][]scopedRoot)
	for action, directories := range paths {
		for _, directory := range directories {
			subroot, err := root.OpenRoot(directory)
			if err != nil {
				for _, opened := range roots {
					for _, scope := range opened {
						scope.root.Close()
					}
				}
				return nil, fmt.Errorf("open allowed directory %s: %w", directory, err)
			}
			roots[action] = append(roots[action], scopedRoot{directory, subroot})
		}
		sort.Slice(roots[action], func(i, j int) bool { return len(roots[action][i].prefix) > len(roots[action][j].prefix) })
	}
	return &Tools{roots: roots, policy: policy, check: check, now: time.Now, completed: map[string]cachedCall{}}, nil
}
func (t *Tools) Close() error {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.closed {
		return nil
	}
	t.closed = true
	var err error
	for _, opened := range t.roots {
		for _, scope := range opened {
			err = errors.Join(err, scope.root.Close())
		}
	}
	return err
}
func (t *Tools) Used() uint64 { t.mu.Lock(); defer t.mu.Unlock(); return t.used }
func validPath(name string, directory bool) bool {
	if !utf8.ValidString(name) || !fs.ValidPath(name) || strings.ContainsAny(name, "\\:\x00") || len(name) > 1024 || (!directory && name == ".") {
		return false
	}
	for _, part := range strings.Split(name, "/") {
		// Keep one portable spelling: case-folded metadata, Windows trailing
		// dots/spaces, short-name aliases and devices must not bypass the gate.
		if part == "." && directory && name == "." {
			continue
		}
		lower := strings.ToLower(part)
		if lower == ".git" || lower == ".claude" || lower == ".codex" || lower == ".agents" || strings.HasPrefix(lower, ".fractalmind-write-") || strings.HasSuffix(part, ".") || strings.HasSuffix(part, " ") || strings.Contains(part, "~") {
			return false
		}
		base := strings.SplitN(strings.ToUpper(part), ".", 2)[0]
		devicePort := false
		if strings.HasPrefix(base, "COM") || strings.HasPrefix(base, "LPT") {
			suffix := []rune(base[3:])
			devicePort = len(suffix) == 1 && strings.ContainsRune("123456789¹²³", suffix[0])
		}
		if base == "CON" || base == "PRN" || base == "AUX" || base == "NUL" || base == "CONIN$" || base == "CONOUT$" || devicePort {
			return false
		}
	}
	return true
}
func (t *Tools) allowed(call Call) bool {
	if call.ID == "" || len(call.ID) > 128 || !validPath(call.Path, call.Action == List) {
		return false
	}
	if call.Action != Write && (call.Content != "" || call.ExpectedHash != "") {
		return false
	}
	if call.Action == Write {
		if !utf8.ValidString(call.Content) || len(call.Content) > MaxFileBytes {
			return false
		}
		if call.ExpectedHash != "" {
			hash, err := hex.DecodeString(call.ExpectedHash)
			if err != nil || len(hash) != 32 {
				return false
			}
		}
	}
	for _, prefix := range t.policy.Paths[call.Action] {
		if prefix == "." || call.Path == prefix || strings.HasPrefix(call.Path, prefix+"/") {
			return true
		}
	}
	return false
}
func (t *Tools) current(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if t.closed || !t.now().Before(t.policy.Deadline) {
		return ErrStopped
	}
	return t.check(ctx)
}
func (t *Tools) scope(call Call) (*os.Root, string) {
	for _, scope := range t.roots[call.Action] {
		if scope.prefix == "." {
			return scope.root, call.Path
		}
		if call.Path == scope.prefix {
			return scope.root, "."
		}
		if strings.HasPrefix(call.Path, scope.prefix+"/") {
			return scope.root, strings.TrimPrefix(call.Path, scope.prefix+"/")
		}
	}
	return nil, ""
}

// Call serializes checks, budgeting and file operations. Exact retries within
// this live run reuse their original result; a restarted run never replays it.
func (t *Tools) Call(ctx context.Context, call Call) (Result, error) {
	if ctx == nil {
		return Result{}, fmt.Errorf("context is required")
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	if !t.allowed(call) {
		return Result{}, ErrBoundary
	}
	if err := t.current(ctx); err != nil {
		return Result{}, err
	}
	encoded, err := json.Marshal(call)
	if err != nil {
		return Result{}, err
	}
	fingerprint := sha256.Sum256(encoded)
	if old, ok := t.completed[call.ID]; ok {
		if old.fingerprint != fingerprint {
			return Result{}, ErrConflict
		}
		result := old.result
		result.Entries = append([]string(nil), result.Entries...)
		return result, old.err
	}
	if t.used >= t.policy.MaxCalls {
		return Result{}, ErrBudget
	}
	// Count accepted attempts, including filesystem errors. Rejected scope,
	// revoked authority and exact retries do not consume another tool call.
	t.used++
	result := Result{ID: call.ID, Action: call.Action, Path: call.Path, Used: t.used, ObservedAt: t.now().UTC()}
	root, name := t.scope(call)
	switch call.Action {
	case Read:
		var data []byte
		data, err = read(root, name)
		if err == nil {
			result.Content = string(data)
			result.Hash = contentHash(data)
		}
	case Write:
		err = t.write(ctx, root, name, call)
		if err == nil {
			result.Hash = contentHash([]byte(call.Content))
		}
	case List:
		var file *os.File
		file, err = root.OpenFile(name, readFlags(), 0)
		if err == nil {
			var entries []fs.DirEntry
			entries, err = file.ReadDir(MaxEntries + 1)
			if errors.Is(err, io.EOF) {
				err = nil
			}
			if closeErr := file.Close(); err == nil {
				err = closeErr
			}
			if len(entries) > MaxEntries {
				result.Truncated = true
				entries = entries[:MaxEntries]
			}
			for _, entry := range entries {
				if validPath(path.Join(call.Path, entry.Name()), true) {
					result.Entries = append(result.Entries, entry.Name())
				}
			}
			sort.Strings(result.Entries)
		}
	}
	t.completed[call.ID] = cachedCall{fingerprint, result, err}
	result.Entries = append([]string(nil), result.Entries...)
	return result, err
}
func contentHash(data []byte) string { hash := sha256.Sum256(data); return hex.EncodeToString(hash[:]) }
func read(root *os.Root, name string) ([]byte, error) {
	file, err := root.OpenFile(name, readFlags(), 0)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return nil, err
	}
	if !safeRegularFile(file, info) || info.Size() > MaxFileBytes {
		return nil, ErrBoundary
	}
	data, err := io.ReadAll(io.LimitReader(file, MaxFileBytes+1))
	if len(data) > MaxFileBytes {
		return nil, ErrBoundary
	}
	if !utf8.Valid(data) {
		return nil, ErrBoundary
	}
	return data, err
}
func (t *Tools) write(ctx context.Context, root *os.Root, name string, call Call) error {
	data, err := read(root, name)
	if err == nil {
		if call.ExpectedHash == "" || contentHash(data) != call.ExpectedHash {
			return ErrConflict
		}
	}
	if errors.Is(err, fs.ErrNotExist) {
		if call.ExpectedHash != "" {
			return ErrConflict
		}
	} else if err != nil {
		return err
	}
	// Create-and-rename prevents editing a symlink/hardlink's outside target.
	// os.Root keeps both parent traversals inside the opened workspace handle.
	parent := path.Dir(name)
	if err := root.MkdirAll(parent, 0700); err != nil {
		return err
	}
	var nonce [16]byte
	if _, err := rand.Read(nonce[:]); err != nil {
		return err
	}
	temporary := path.Join(parent, ".fractalmind-write-"+hex.EncodeToString(nonce[:]))
	file, err := root.OpenFile(temporary, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	defer root.Remove(temporary)
	_, writeErr := file.WriteString(call.Content)
	if writeErr == nil {
		writeErr = file.Sync()
	}
	closeErr := file.Close()
	if writeErr != nil {
		return writeErr
	}
	if closeErr != nil {
		return closeErr
	}
	// Do not publish a prepared file after a stop/revocation arrived while it
	// was being written. The attempted operation stays charged.
	if err := t.current(ctx); err != nil {
		return err
	}
	current, err := read(root, name)
	if call.ExpectedHash == "" {
		if !errors.Is(err, fs.ErrNotExist) {
			return ErrConflict
		}
	} else if err != nil || contentHash(current) != call.ExpectedHash {
		return ErrConflict
	}
	return root.Rename(temporary, name)
}
