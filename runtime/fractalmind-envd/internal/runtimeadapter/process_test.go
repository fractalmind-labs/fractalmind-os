package runtimeadapter

import (
	"context"
	"encoding/json"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestProcessAdapterParsesFailedResponseFromNonzeroExit(t *testing.T) {
	adapter := helperAdapter(t, "failed")
	response, err := adapter.run(context.Background(), Request{
		SchemaVersion: SchemaVersion,
		CommandID:     "cmd-stop",
		Operation:     OperationStop,
		Agent:         "dev",
	})
	if err != nil {
		t.Fatalf("Run returned transport error: %v", err)
	}
	if response.OK || response.Error == nil || response.Error.Code != "operation_failed" {
		t.Fatalf("unexpected response: %+v", response)
	}
}

func TestProcessAdapterTimeoutAndCancellation(t *testing.T) {
	for _, tc := range []struct {
		name    string
		request Request
		want    string
	}{
		{name: "timeout", request: Request{SchemaVersion: SchemaVersion, CommandID: "cmd-timeout", Operation: OperationHealth, TimeoutSeconds: 0.02}, want: "timeout"},
		{name: "cancel", request: Request{SchemaVersion: SchemaVersion, CommandID: "cmd-cancel", Operation: OperationHealth, Cancel: true}, want: "cancelled"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			adapter := helperAdapter(t, "sleep")
			_, err := adapter.run(context.Background(), tc.request)
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("Run error = %v, want %q", err, tc.want)
			}
		})
	}
}

func TestProcessAdapterRejectsPartialOutput(t *testing.T) {
	adapter := helperAdapter(t, "partial")
	_, err := adapter.run(context.Background(), Request{SchemaVersion: SchemaVersion, CommandID: "cmd-partial", Operation: OperationHealth})
	if err == nil || !strings.Contains(err.Error(), "decode adapter response") {
		t.Fatalf("Run error = %v", err)
	}
}

func TestAgentManagerProcessContractStatusAndLifecycle(t *testing.T) {
	adapter := AgentManager(os.Args[0], "-test.run=TestHelperProcess", "--", "echo")
	for _, request := range []Request{
		{SchemaVersion: SchemaVersion, CommandID: "cmd-status", Operation: OperationStatus, Agent: "dev"},
		{SchemaVersion: SchemaVersion, CommandID: "cmd-start", Operation: OperationStart, Agent: "dev", Params: &OperationParams{Restore: boolPointer(true)}},
	} {
		response, err := adapter.run(context.Background(), request)
		if err != nil {
			t.Fatalf("Run(%s): %v", request.Operation, err)
		}
		if !response.OK || response.Operation != request.Operation || response.CommandID != request.CommandID {
			t.Fatalf("unexpected response for %s: %+v", request.Operation, response)
		}
	}
}

func TestProcessAdapterTimeoutKillsDescendants(t *testing.T) {
	if !supportsProcessGroupCancellation() {
		t.Skip("process-group cancellation is only available on Unix")
	}
	sentinel := filepath.Join(t.TempDir(), "descendant-survived")
	adapter := &processAdapter{
		Command: os.Args[0],
		Args:    []string{"-test.run=TestHelperProcess", "--", "spawn-descendant", sentinel},
	}
	_, err := adapter.run(context.Background(), Request{
		SchemaVersion:  SchemaVersion,
		CommandID:      "cmd-descendant-timeout",
		Operation:      OperationHealth,
		TimeoutSeconds: 0.05,
	})
	if err == nil || RunErrorCode(err) != "timeout" {
		t.Fatalf("Run error=%v, want timeout", err)
	}
	time.Sleep(700 * time.Millisecond)
	if _, err := os.Stat(sentinel); !os.IsNotExist(err) {
		t.Fatalf("descendant survived process-group cancellation: %v", err)
	}
}

func helperAdapter(t *testing.T, mode string) *processAdapter {
	t.Helper()
	return &processAdapter{
		Command: os.Args[0],
		Args:    []string{"-test.run=TestHelperProcess", "--", mode},
	}
}

func TestHelperProcess(t *testing.T) {
	if os.Getenv("GO_WANT_HELPER_PROCESS") != "1" {
		return
	}
	args := os.Args
	mode := args[len(args)-1]
	for i, arg := range args {
		if arg == "--" && i+1 < len(args) {
			mode = args[i+1]
			break
		}
	}
	switch mode {
	case "failed":
		_, _ = os.Stdout.WriteString(`{"schema_version":"1","adapter":"agent-manager-runtime","command_id":"cmd-stop","operation":"stop","duplicate":false,"ok":false,"observed_at":"2026-07-19T00:00:00Z","result":{"exit_code":1,"stdout":"partial","stderr":"failed"},"error":{"code":"operation_failed","message":"stop exited with 1"}}`)
		os.Exit(1)
	case "sleep":
		time.Sleep(time.Minute)
	case "partial":
		_, _ = os.Stdout.WriteString(`{"schema_version":"1"`)
		os.Exit(0)
	case "echo":
		raw, _ := io.ReadAll(os.Stdin)
		var request Request
		if err := json.Unmarshal(raw, &request); err != nil {
			os.Exit(2)
		}
		response := Response{
			SchemaVersion: SchemaVersion,
			Adapter:       AdapterName,
			CommandID:     request.CommandID,
			Operation:     request.Operation,
			OK:            true,
			ObservedAt:    "2026-07-19T00:00:00Z",
			Result:        json.RawMessage(`{"exit_code":0,"stdout":"ok","stderr":""}`),
		}
		_ = json.NewEncoder(os.Stdout).Encode(response)
		os.Exit(0)
	case "spawn-descendant":
		marker := args[len(args)-1]
		child := exec.Command(os.Args[0], "-test.run=TestHelperProcess", "--", "descendant", marker)
		child.Env = append(os.Environ(), "GO_WANT_HELPER_PROCESS=1")
		if err := child.Start(); err != nil {
			os.Exit(3)
		}
		time.Sleep(time.Minute)
	case "descendant":
		marker := args[len(args)-1]
		time.Sleep(300 * time.Millisecond)
		if err := os.WriteFile(marker, []byte("alive"), 0o600); err != nil {
			os.Exit(4)
		}
		os.Exit(0)
	}
}

func boolPointer(value bool) *bool { return &value }

func TestMain(m *testing.M) {
	for _, arg := range os.Args {
		if arg == "--" {
			_ = os.Setenv("GO_WANT_HELPER_PROCESS", "1")
			break
		}
	}
	os.Exit(m.Run())
}
