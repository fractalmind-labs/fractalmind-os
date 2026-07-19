package runtimeadapter

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestAgentManagerContractFixtures(t *testing.T) {
	for _, tc := range []struct {
		name      string
		commandID string
		operation Operation
	}{
		{name: "availability-response.json", commandID: "cmd-availability-sample", operation: OperationAvailability},
		{name: "start-response.json", commandID: "cmd-start-sample", operation: OperationStart},
	} {
		raw, err := os.ReadFile(filepath.Join("testdata", tc.name))
		if err != nil {
			t.Fatal(err)
		}
		var response Response
		if err := json.Unmarshal(raw, &response); err != nil {
			t.Fatalf("decode %s: %v", tc.name, err)
		}
		request := Request{SchemaVersion: SchemaVersion, CommandID: tc.commandID, Operation: tc.operation}
		if tc.operation.RequiresAgent() {
			request.Agent = "dev"
		}
		if err := response.Validate(request); err != nil {
			t.Fatalf("validate %s: %v", tc.name, err)
		}
	}
}

func TestRequestAndResponseRejectUnboundedContractValues(t *testing.T) {
	request := Request{
		SchemaVersion:  SchemaVersion,
		CommandID:      "cmd-1",
		Operation:      OperationHealth,
		TimeoutSeconds: MaxTimeoutSeconds + 1,
	}
	if err := request.Validate(); err == nil {
		t.Fatal("request accepted unbounded timeout")
	}

	response := Response{
		SchemaVersion: SchemaVersion,
		Adapter:       AdapterName,
		CommandID:     "cmd-1",
		Operation:     OperationHealth,
		ObservedAt:    "2026-07-19T00:00:00Z",
		Error:         &Error{Code: "unstable"},
	}
	request.TimeoutSeconds = 0
	if err := response.Validate(request); err == nil {
		t.Fatal("response accepted unstable error code")
	}
}

func TestRequestRejectsUnsafeOperationParamsAndTargetCardinality(t *testing.T) {
	tooManyLines := MaxLogLines + 1
	follow := true
	for _, request := range []Request{
		{SchemaVersion: SchemaVersion, CommandID: "cmd-health", Operation: OperationHealth, Agent: "dev"},
		{SchemaVersion: SchemaVersion, CommandID: "cmd-status", Operation: OperationStatus},
		{SchemaVersion: SchemaVersion, CommandID: "cmd-assign", Operation: OperationAssign, Agent: "dev", Params: &OperationParams{Task: " "}},
		{SchemaVersion: SchemaVersion, CommandID: "cmd-logs", Operation: OperationLogs, Agent: "dev", Params: &OperationParams{Lines: &tooManyLines, Follow: boolPointer(false)}},
		{SchemaVersion: SchemaVersion, CommandID: "cmd-monitor", Operation: OperationMonitor, Agent: "dev", Params: &OperationParams{Lines: intPointer(10), Follow: &follow}},
	} {
		if err := request.Validate(); err == nil {
			t.Fatalf("unsafe request accepted: %+v", request)
		}
	}
}

func intPointer(value int) *int { return &value }
