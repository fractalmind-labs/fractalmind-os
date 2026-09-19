package runtimeadapter

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"
)

func TestRealAgentManagerCLIStatusAndLifecycleError(t *testing.T) {
	mainPath := os.Getenv("FRACTALMIND_AGENT_MANAGER_MAIN")
	if mainPath == "" {
		t.Skip("set FRACTALMIND_AGENT_MANAGER_MAIN to run the real agent-manager CLI integration")
	}
	if _, err := os.Stat(mainPath); err != nil {
		t.Fatalf("agent-manager CLI: %v", err)
	}

	adapter := AgentManager("python3", mainPath)
	process, ok := adapter.(*processAdapter)
	if !ok {
		t.Fatalf("AgentManager returned %T", adapter)
	}
	process.Env = []string{"REPO_ROOT=" + t.TempDir()}
	suffix := fmt.Sprintf("%d-%d", os.Getpid(), time.Now().UnixNano())
	executor := NewExecutor(testValidator(), adapter)
	statusCommand := runtimeCommand("status", "lifecycle", `{}`)
	statusCommand.CommandID = "envd-real-status-" + suffix
	statusCommand.IdempotencyKey = "envd-real-status-idem-" + suffix
	statusCommand.Nonce = "envd-real-status-nonce-" + suffix
	statusCommand.Target.AgentID = "main"
	status, _, err := executor.Execute(context.Background(), statusCommand)
	if err != nil || !status.OK || len(status.Result) == 0 {
		t.Fatalf("real status: response=%+v err=%v", status, err)
	}

	missingCommand := runtimeCommand("start", "lifecycle", `{"restore":false}`)
	missingCommand.CommandID = "envd-real-start-missing-" + suffix
	missingCommand.IdempotencyKey = "envd-real-start-missing-idem-" + suffix
	missingCommand.Nonce = "envd-real-start-missing-nonce-" + suffix
	missingCommand.Target.AgentID = "__envd_missing_agent__"
	missing, _, err := executor.Execute(context.Background(), missingCommand)
	if err != nil {
		t.Fatalf("real lifecycle error transport: %v", err)
	}
	if missing.OK || missing.Error == nil || missing.Error.Code != "missing_agent" {
		t.Fatalf("unexpected real lifecycle response: %+v", missing)
	}
}
