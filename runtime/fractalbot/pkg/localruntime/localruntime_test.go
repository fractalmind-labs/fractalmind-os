package localruntime

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"net"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

const thread = "01a15669-badd-7c31-b094-660961b49af7"

func request(prompt string) Request {
	return Request{Envelope: Envelope{ID: NewEnvelopeID(), Channel: "feishu", SelectedAgent: "xiaoyi", Text: "hi"}, Prompt: prompt}
}

func TestInboxRoundTripAndCoalescing(t *testing.T) {
	inbox := filepath.Join(t.TempDir(), "inbox", "xiaoyi")
	path, err := WriteInbox(inbox, request("hello").Envelope, "hello")
	if err != nil {
		t.Fatal(err)
	}
	if runtime.GOOS != "windows" {
		if info, _ := os.Stat(path); info.Mode().Perm() != 0o600 {
			t.Fatalf("envelope mode %v", info.Mode().Perm())
		}
	}
	env, prompt, err := ReadInboxFile(path)
	if err != nil || prompt != "hello" || env.SelectedAgent != "xiaoyi" {
		t.Fatalf("read back: %+v %q %v", env, prompt, err)
	}

	hb := Envelope{ID: "a", Source: "heartbeat", CoalesceKey: "heartbeat:job-1"}
	first, _ := WriteInbox(inbox, hb, "first wakeup")
	hb.ID = "b"
	second, _ := WriteInbox(inbox, hb, "second wakeup")
	if first != second {
		t.Fatalf("coalesced wakeups use one file: %s %s", first, second)
	}
	if _, prompt, _ := ReadInboxFile(second); prompt != "second wakeup" {
		t.Fatalf("newer wakeup must replace the waiting one, got %q", prompt)
	}

	legacy := filepath.Join(inbox, "legacy.json")
	os.WriteFile(legacy, []byte(`{"envelope":{"id":"x"},"prompt":"from an older writer"}`), 0o600)
	if _, prompt, err := ReadInboxFile(legacy); err != nil || prompt != "from an older writer" {
		t.Fatalf("versionless envelope: %q %v", prompt, err)
	}
	future := filepath.Join(inbox, "future.json")
	os.WriteFile(future, []byte(`{"version":9,"envelope":{"id":"x"},"prompt":"p"}`), 0o600)
	if _, _, err := ReadInboxFile(future); err == nil {
		t.Fatal("newer envelope version accepted")
	}
}

// fakeSession is a Claude Desktop messaging socket that records prompts.
func fakeSession(t *testing.T) (string, <-chan string) {
	t.Helper()
	dir, err := os.MkdirTemp("/tmp", "lrt")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.RemoveAll(dir) })
	sock := filepath.Join(dir, "s.sock")
	ln, err := net.Listen("unix", sock)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { ln.Close() })
	os.Chmod(sock, 0o600)
	prompts := make(chan string, 10)
	go func() {
		for {
			conn, err := ln.Accept()
			if err != nil {
				return
			}
			go func(c net.Conn) {
				defer c.Close()
				sc := bufio.NewScanner(c)
				sc.Buffer(make([]byte, 1<<20), 1<<20)
				for sc.Scan() {
					var frame struct {
						Type    string `json:"type"`
						Token   string `json:"token"`
						Message struct {
							Content string `json:"content"`
						} `json:"message"`
					}
					if json.Unmarshal(sc.Bytes(), &frame) == nil && frame.Type == "user" {
						prompts <- frame.Message.Content
					}
				}
			}(conn)
		}
	}()
	return sock, prompts
}

func TestClaudeDesktopDeliverAndRelay(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("the relay uses a Unix socket")
	}
	inbox := filepath.Join(t.TempDir(), "xiaoyi-desktop")
	target := Target{Agent: "xiaoyi-desktop", Inbox: inbox}
	cd := ClaudeDesktop{}
	res := cd.Deliver(context.Background(), target, request("wake up"))
	if res.Status != Queued || res.Err != nil || !strings.HasPrefix(res.Location, inbox) {
		t.Fatalf("deliver: %+v", res)
	}
	if cd.Presence(context.Background(), target) != Offline {
		t.Fatal("no relay yet: expected offline")
	}
	os.WriteFile(filepath.Join(inbox, "bad.json"), []byte("{"), 0o600)

	sock, prompts := fakeSession(t)
	if err := RunRelay(context.Background(), RelayOptions{Inbox: inbox, SocketPath: sock, Token: "t", Once: true}); err != nil {
		t.Fatal(err)
	}
	select {
	case got := <-prompts:
		if got != "wake up" {
			t.Fatalf("relayed %q", got)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("prompt not relayed")
	}
	if done, _ := os.ReadDir(filepath.Join(inbox, "done")); len(done) != 1 {
		t.Fatalf("done: %d entries", len(done))
	}
	if bad, _ := os.ReadDir(filepath.Join(inbox, "failed")); len(bad) != 1 {
		t.Fatalf("failed: %d entries", len(bad))
	}

	// A running relay holds the inbox: presence is online and a second relay
	// stops.
	ctx, cancel := context.WithCancel(context.Background())
	stopped := make(chan error, 1)
	go func() {
		stopped <- RunRelay(ctx, RelayOptions{Inbox: inbox, SocketPath: sock, Token: "t", PollInterval: 10 * time.Millisecond})
	}()
	deadline := time.Now().Add(3 * time.Second)
	for cd.Presence(context.Background(), target) != Online {
		if time.Now().After(deadline) {
			t.Fatal("relay never came online")
		}
		time.Sleep(10 * time.Millisecond)
	}
	if err := RunRelay(context.Background(), RelayOptions{Inbox: inbox, SocketPath: sock, Token: "t", Once: true}); !errors.Is(err, ErrRelayRunning) {
		t.Fatalf("second relay: %v", err)
	}
	cd.Deliver(context.Background(), target, request("while online"))
	select {
	case got := <-prompts:
		if got != "while online" {
			t.Fatalf("relayed %q", got)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("running relay did not deliver")
	}
	cancel()
	<-stopped
	if cd.Presence(context.Background(), target) != Offline {
		t.Fatal("stopped relay must release the inbox")
	}
}

func writeScript(t *testing.T, name, body string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), name)
	if err := os.WriteFile(path, []byte(body), 0o700); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestCodexAppQueue(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("uses a POSIX shell script")
	}
	codex := writeScript(t, "codex", `#!/bin/sh
[ "$1" = queue ] && [ "$2" = --thread ] && [ "$4" = --message ] || exit 2
case "$5" in
  reject*) echo "message text leaked" >&2; exit 1 ;;
  silent*) echo "ok" ; exit 0 ;;
esac
echo "Queued message for thread $3"
`)
	c := CodexApp{Codex: codex}
	target := Target{Agent: "xiaoyi", Workspace: t.TempDir(), Session: thread}
	if res := c.Deliver(context.Background(), target, request("hello")); res.Status != Queued || res.Err != nil {
		t.Fatalf("queue: %+v", res)
	}
	res := c.Deliver(context.Background(), target, request("reject this"))
	if res.Status != Failed || !strings.Contains(res.Err.Error(), "exit code 1") || strings.Contains(res.Err.Error(), "leaked") {
		t.Fatalf("rejected: %+v", res)
	}
	if res := c.Deliver(context.Background(), target, request("silent")); res.Status != Failed || !strings.Contains(res.Err.Error(), "did not confirm") {
		t.Fatalf("unconfirmed: %+v", res)
	}
	target.Session = "main"
	if res := c.Deliver(context.Background(), target, request("hello")); res.Status != Failed {
		t.Fatalf("bad session: %+v", res)
	}
	if c.Presence(context.Background(), target) != Unknown {
		t.Fatal("codex presence is unknown")
	}
}

func TestAgentManager(t *testing.T) {
	workspace := t.TempDir()
	script := writeScript(t, "am.py", `import pathlib, sys
args = sys.argv[1:]
state = pathlib.Path("running")
if args[0] == "status":
    print("   Running: yes" if state.exists() else "   Running: no")
elif args[0] == "start":
    state.write_text("1")
elif args[0] == "assign":
    pathlib.Path("assigned.txt").write_text(sys.stdin.read())
elif args[0] == "heartbeat":
    print("HB_ID: hb-42")
    if args[2] == "broken":
        sys.exit("heartbeat failed")
`)
	am := AgentManager{Script: func(Target) string { return script }}
	target := Target{Agent: "burry", Workspace: workspace, Session: "main"}
	ctx := context.Background()
	if am.Presence(ctx, target) != Offline {
		t.Fatal("expected offline")
	}
	if err := am.Start(ctx, target); err != nil || am.Presence(ctx, target) != Online {
		t.Fatalf("start: %v", err)
	}
	if res := am.Deliver(ctx, target, request("do it")); res.Status != Delivered || res.Err != nil {
		t.Fatalf("assign: %+v", res)
	}
	if got, _ := os.ReadFile(filepath.Join(workspace, "assigned.txt")); string(got) != "do it" {
		t.Fatalf("assigned prompt %q", got)
	}
	req := request("")
	req.Mode = HeartbeatRun
	if res := am.Deliver(ctx, target, req); res.Status != Completed || res.Location != "heartbeat hb-42" {
		t.Fatalf("heartbeat run: %+v", res)
	}
	target.Session = "broken"
	if res := am.Deliver(ctx, target, req); res.Status != Failed || res.Location != "heartbeat hb-42" {
		t.Fatalf("failed heartbeat run: %+v", res)
	}
}
