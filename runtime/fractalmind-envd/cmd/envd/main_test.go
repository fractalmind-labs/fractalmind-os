package main

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/fractalmind-ai/fractalmind-envd/internal/config"
	"github.com/fractalmind-ai/fractalmind-envd/internal/nodecommand"
	"github.com/fractalmind-ai/fractalmind-envd/internal/runtimeadapter"
	"github.com/fractalmind-ai/fractalmind-envd/internal/ws"
	"github.com/fractalmind-ai/fractalmind-envd/internal/wsauth"
)

func TestSignedCommandWithoutStateDirExecutorFailsClosed(t *testing.T) {
	t.Setenv("FRACTALMIND_RUNTIME_STATE_DIR", "")

	executor, err := newRuntimeCommandExecutorFromEnv(testRuntimeConfig())
	if err != nil {
		t.Fatalf("newRuntimeCommandExecutorFromEnv: %v", err)
	}
	if executor != nil {
		t.Fatal("missing FRACTALMIND_RUNTIME_STATE_DIR must not create memory-backed executor")
	}

	result := handleSignedCommand(context.Background(), `{}`, executor)
	if result["success"] != false {
		t.Fatalf("success = %v, want false", result["success"])
	}
	if result["error_code"] != "runtime_state_dir_required" {
		t.Fatalf("error_code = %v, want runtime_state_dir_required", result["error_code"])
	}
	if !strings.Contains(fmt.Sprint(result["error"]), "FRACTALMIND_RUNTIME_STATE_DIR") {
		t.Fatalf("error = %v, want state-dir guidance", result["error"])
	}
}

func TestRuntimeCommandExecutorRejectsUnusableStateDir(t *testing.T) {
	blockingFile := t.TempDir() + "/state-file"
	if err := os.WriteFile(blockingFile, []byte("not a directory"), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("FRACTALMIND_RUNTIME_STATE_DIR", blockingFile)

	if _, err := newRuntimeCommandExecutorFromEnv(testRuntimeConfig()); err == nil {
		t.Fatal("unusable FRACTALMIND_RUNTIME_STATE_DIR was accepted")
	}
}

func TestRuntimeCommandExecutorRequiresAuthorityFile(t *testing.T) {
	t.Setenv("FRACTALMIND_RUNTIME_STATE_DIR", t.TempDir())

	if _, err := newRuntimeCommandExecutorFromEnv(testRuntimeConfig()); err == nil {
		t.Fatal("missing authority state file was accepted")
	}
}

func TestHandleCommandSignedCommandReusesPriorSuccessAfterRestart(t *testing.T) {
	stateDir := t.TempDir()
	callCount := stateDir + "/calls"
	now := fixedRuntimeNow()
	identity := newRuntimeSigningIdentity(t)
	writeRuntimeAuthorityFile(t, stateDir, validRuntimeState(now, identity.signer))
	command := identity.sign(validRuntimeCommand(now, "cmd-success", "nonce-success", "idem-success"))
	rawCommand := mustJSON(t, command)

	firstExecutor := newTestPersistentRuntimeExecutor(t, stateDir, "success", callCount)
	first := handleCommand(ws.CommandPayload{Command: "signed-command", Args: rawCommand}, nil, nil, firstExecutor)
	if first["success"] != true {
		t.Fatalf("first success = %v, result=%+v", first["success"], first)
	}
	if countRuntimeAdapterCalls(t, callCount) != 1 {
		t.Fatalf("adapter calls after first execution = %d, want 1", countRuntimeAdapterCalls(t, callCount))
	}

	restartedExecutor := newTestPersistentRuntimeExecutor(t, stateDir, "unexpected-success", callCount)
	second := handleCommand(ws.CommandPayload{Command: "signed_command", Args: rawCommand}, nil, nil, restartedExecutor)
	if second["success"] != true {
		t.Fatalf("second success = %v, result=%+v", second["success"], second)
	}
	response, ok := second["response"].(runtimeadapter.Response)
	if !ok {
		t.Fatalf("second response type = %T", second["response"])
	}
	if !response.Duplicate {
		t.Fatalf("second response duplicate = false: %+v", response)
	}
	if countRuntimeAdapterCalls(t, callCount) != 1 {
		t.Fatalf("adapter reran after restart duplicate: calls=%d", countRuntimeAdapterCalls(t, callCount))
	}
}

func TestHandleCommandSignedCommandReusesPriorFailureAfterRestart(t *testing.T) {
	stateDir := t.TempDir()
	callCount := stateDir + "/calls"
	now := fixedRuntimeNow()
	identity := newRuntimeSigningIdentity(t)
	writeRuntimeAuthorityFile(t, stateDir, validRuntimeState(now, identity.signer))
	command := identity.sign(validRuntimeCommand(now, "cmd-failure", "nonce-failure", "idem-failure"))
	rawCommand := mustJSON(t, command)

	firstExecutor := newTestPersistentRuntimeExecutor(t, stateDir, "fail", callCount)
	first := handleCommand(ws.CommandPayload{Command: "node_command", Args: rawCommand}, nil, nil, firstExecutor)
	if first["success"] != false {
		t.Fatalf("first success = %v, want false: %+v", first["success"], first)
	}
	if first["error_code"] != "operation_failed" {
		t.Fatalf("first error_code = %v, want operation_failed", first["error_code"])
	}
	if countRuntimeAdapterCalls(t, callCount) != 1 {
		t.Fatalf("adapter calls after first failure = %d, want 1", countRuntimeAdapterCalls(t, callCount))
	}

	restartedExecutor := newTestPersistentRuntimeExecutor(t, stateDir, "unexpected-success", callCount)
	second := handleCommand(ws.CommandPayload{Command: "signed_command", Args: rawCommand}, nil, nil, restartedExecutor)
	if second["success"] != false {
		t.Fatalf("second success = %v, want false: %+v", second["success"], second)
	}
	if second["error_code"] != "operation_failed" {
		t.Fatalf("second error_code = %v, want operation_failed", second["error_code"])
	}
	response, ok := second["response"].(runtimeadapter.Response)
	if !ok {
		t.Fatalf("second response type = %T", second["response"])
	}
	if !response.Duplicate || response.Error == nil || response.Error.Code != "operation_failed" {
		t.Fatalf("second response did not reuse failed evidence: %+v", response)
	}
	if countRuntimeAdapterCalls(t, callCount) != 1 {
		t.Fatalf("adapter reran failed restart duplicate: calls=%d", countRuntimeAdapterCalls(t, callCount))
	}
}

func TestShippedSignedCommandConstructorRejectsInvalidCommandBeforeAdapter(t *testing.T) {
	stateDir := t.TempDir()
	callCount := stateDir + "/calls"
	now := fixedRuntimeNow()
	identity := newRuntimeSigningIdentity(t)
	writeRuntimeAuthorityFile(t, stateDir, validRuntimeState(now, identity.signer))
	command := identity.sign(validRuntimeCommand(now, "cmd-invalid", "nonce-invalid", "idem-invalid"))
	command.Target.NodeID = "wrong-node"
	rawCommand := mustJSON(t, command)

	executor := newTestPersistentRuntimeExecutor(t, stateDir, "success", callCount)
	result := handleCommand(ws.CommandPayload{Command: "signed_command", Args: rawCommand}, nil, nil, executor)
	if result["success"] != false {
		t.Fatalf("invalid command success = %v, want false: %+v", result["success"], result)
	}
	if result["error_code"] != nodecommand.CodeWrongTarget {
		t.Fatalf("error_code = %v, want %s", result["error_code"], nodecommand.CodeWrongTarget)
	}
	event, ok := result["event"].(nodecommand.NodeEvent)
	if !ok {
		t.Fatalf("result event type = %T, want NodeEvent: %+v", result["event"], result)
	}
	if event.CommandID != command.CommandID || event.Type != "command_rejected" || event.ResultCode != string(nodecommand.CodeWrongTarget) ||
		event.ResultHash == "" || event.EvidenceHash == "" {
		t.Fatalf("unexpected rejection event: %+v", event)
	}
	if countRuntimeAdapterCalls(t, callCount) != 0 {
		t.Fatalf("invalid command reached adapter: calls=%d", countRuntimeAdapterCalls(t, callCount))
	}
}

func TestHandleSignedCommandMalformedJSONHasNoNodeEvent(t *testing.T) {
	result := handleSignedCommand(context.Background(), `{"command_id":`, runtimeCommandExecutorFunc(func(context.Context, nodecommand.NodeCommand) (runtimeadapter.Response, nodecommand.NodeEvent, error) {
		t.Fatal("executor must not be called for malformed JSON")
		return runtimeadapter.Response{}, nodecommand.NodeEvent{}, nil
	}))
	if result["success"] != false || result["error_code"] != "invalid_envelope" {
		t.Fatalf("unexpected malformed JSON result: %+v", result)
	}
	if _, ok := result["event"]; ok {
		t.Fatalf("malformed JSON result included NodeEvent: %+v", result)
	}
}

func TestHandleCommandShellTimesOutAndReleasesHandler(t *testing.T) {
	cfg := &config.Config{Agents: config.AgentsConfig{
		AllowShell:   true,
		ShellTimeout: "50ms",
	}}

	started := time.Now()
	result := handleCommand(ws.CommandPayload{
		Command: "shell",
		Args:    "printf started; sleep 30",
	}, nil, cfg, nil)

	if result["success"] != false {
		t.Fatalf("success = %v, want false: %+v", result["success"], result)
	}
	if !strings.Contains(fmt.Sprint(result["error"]), "timed out after 50ms") {
		t.Fatalf("error = %v, want timeout", result["error"])
	}
	if result["output"] != "started" {
		t.Fatalf("output = %q, want started", result["output"])
	}
	if elapsed := time.Since(started); elapsed > 2*time.Second {
		t.Fatalf("shell timeout took %s, handler remained blocked", elapsed)
	}
}

type runtimeCommandExecutorFunc func(context.Context, nodecommand.NodeCommand) (runtimeadapter.Response, nodecommand.NodeEvent, error)

func (f runtimeCommandExecutorFunc) Execute(ctx context.Context, command nodecommand.NodeCommand) (runtimeadapter.Response, nodecommand.NodeEvent, error) {
	return f(ctx, command)
}

func newTestPersistentRuntimeExecutor(
	t *testing.T,
	stateDir string,
	helperMode string,
	callCount string,
) runtimeCommandExecutor {
	t.Helper()
	t.Setenv("ENVD_RUNTIME_ADAPTER_HELPER", "1")
	t.Setenv("ENVD_RUNTIME_ADAPTER_HELPER_MODE", helperMode)
	t.Setenv("ENVD_RUNTIME_ADAPTER_CALL_COUNT", callCount)
	t.Setenv("FRACTALMIND_RUNTIME_STATE_DIR", stateDir)
	t.Setenv("FRACTALMIND_AGENT_MANAGER_COMMAND", os.Args[0])
	t.Setenv("FRACTALMIND_AGENT_MANAGER_ARGS", "-test.run=TestEnvdRuntimeAdapterHelperProcess --")

	executor, err := newRuntimeCommandExecutorFromEnv(testRuntimeConfig())
	if err != nil {
		t.Fatalf("newRuntimeCommandExecutorFromEnv: %v", err)
	}
	if executor == nil {
		t.Fatal("executor is nil")
	}
	return executor
}

func TestEnvdRuntimeAdapterHelperProcess(t *testing.T) {
	if os.Getenv("ENVD_RUNTIME_ADAPTER_HELPER") != "1" {
		return
	}
	countFile := os.Getenv("ENVD_RUNTIME_ADAPTER_CALL_COUNT")
	if countFile != "" {
		f, err := os.OpenFile(countFile, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
		if err != nil {
			fmt.Fprintf(os.Stderr, "open call count: %v", err)
			os.Exit(2)
		}
		_, _ = f.WriteString("1\n")
		_ = f.Close()
	}

	var request runtimeadapter.Request
	if err := json.NewDecoder(os.Stdin).Decode(&request); err != nil {
		fmt.Fprintf(os.Stderr, "decode request: %v", err)
		os.Exit(2)
	}
	switch os.Getenv("ENVD_RUNTIME_ADAPTER_HELPER_MODE") {
	case "success", "unexpected-success":
		response := runtimeadapter.Response{
			SchemaVersion: runtimeadapter.SchemaVersion,
			Adapter:       runtimeadapter.AdapterName,
			CommandID:     request.CommandID,
			Operation:     request.Operation,
			OK:            true,
			ObservedAt:    "2026-07-19T00:00:00Z",
			Result:        json.RawMessage(`{"status":"ok"}`),
		}
		if err := json.NewEncoder(os.Stdout).Encode(response); err != nil {
			fmt.Fprintf(os.Stderr, "encode response: %v", err)
			os.Exit(2)
		}
		os.Exit(0)
	case "fail":
		fmt.Fprint(os.Stderr, "boom")
		os.Exit(2)
	default:
		fmt.Fprintf(os.Stderr, "unknown helper mode %q", os.Getenv("ENVD_RUNTIME_ADAPTER_HELPER_MODE"))
		os.Exit(2)
	}
}

func validRuntimeCommand(now time.Time, commandID, nonce, idempotencyKey string) nodecommand.NodeCommand {
	payload := []byte(`{}`)
	return nodecommand.NodeCommand{
		Version:        nodecommand.ProtocolVersion,
		CommandID:      commandID,
		Signer:         "",
		Target:         nodecommand.Target{OrganizationID: "org-1", NodeID: "node-1", AgentID: "agent-1"},
		Action:         "status",
		Scope:          "lifecycle",
		Capability:     nodecommand.CapabilityRef{ID: "cap-1", RevocationVersion: 7},
		Nonce:          nonce,
		IssuedAtMS:     now.UnixMilli(),
		ExpiresAtMS:    now.Add(time.Minute).UnixMilli(),
		IdempotencyKey: idempotencyKey,
		Payload:        payload,
		PayloadHash:    nodecommand.HashPayload(payload),
		Signature:      "",
	}
}

func validRuntimeState(now time.Time, signer string) nodecommand.CapabilityState {
	remainingUses := uint64(1)
	return nodecommand.CapabilityState{
		ID:                     "cap-1",
		Target:                 nodecommand.Target{OrganizationID: "org-1", NodeID: "node-1", AgentID: "agent-1"},
		AuthorizedSigners:      []string{signer},
		Actions:                []string{"status"},
		Scopes:                 []string{"lifecycle"},
		ExpiresAtMS:            now.Add(5 * time.Minute).UnixMilli(),
		RevocationVersion:      7,
		CheckpointObservedAtMS: now.UnixMilli(),
		ReservationScope:       nodecommand.ReservationScopeNode,
		RemainingUses:          &remainingUses,
	}
}

func testRuntimeConfig() *config.Config {
	cfg := config.DefaultConfig()
	cfg.Identity.HostID = "node-1"
	cfg.Identity.Hostname = "node-1"
	cfg.SUI.OrgID = "org-1"
	return cfg
}

func writeRuntimeAuthorityFile(t *testing.T, stateDir string, state nodecommand.CapabilityState) {
	t.Helper()
	raw, err := json.Marshal(struct {
		Capabilities []nodecommand.CapabilityState `json:"capabilities"`
	}{Capabilities: []nodecommand.CapabilityState{state}})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(stateDir+"/authority.json", raw, 0o600); err != nil {
		t.Fatal(err)
	}
}

type runtimeSigningIdentity struct {
	private ed25519.PrivateKey
	public  ed25519.PublicKey
	signer  string
}

func newRuntimeSigningIdentity(t *testing.T) runtimeSigningIdentity {
	t.Helper()
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	return runtimeSigningIdentity{
		private: priv,
		public:  pub,
		signer:  wsauth.DeriveAddress(pub),
	}
}

func (i runtimeSigningIdentity) sign(command nodecommand.NodeCommand) nodecommand.NodeCommand {
	command.Signer = i.signer
	command.Signature = ""
	signingBytes, err := command.SigningBytes()
	if err != nil {
		panic(err)
	}
	signature := ed25519.Sign(i.private, signingBytes)
	command.Signature = "ed25519:" + hex.EncodeToString(i.public) + ":" + hex.EncodeToString(signature)
	return command
}

func fixedRuntimeNow() time.Time {
	return time.Now().UTC()
}

func mustJSON(t *testing.T, value interface{}) string {
	t.Helper()
	raw, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return string(raw)
}

func countRuntimeAdapterCalls(t *testing.T, path string) int {
	t.Helper()
	raw, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return 0
	}
	if err != nil {
		t.Fatal(err)
	}
	count := 0
	for _, line := range strings.Split(string(raw), "\n") {
		if strings.TrimSpace(line) != "" {
			count++
		}
	}
	return count
}
