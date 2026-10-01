package runtimeadapter

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/boundedrun"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/nodecommand"
)

type boundedFileAgent struct {
	reader     boundedrun.ExecutionAuthority
	workspaces map[string]string
	observer   Adapter
}

// BoundedFileAgent supports an explicit, measurable native file-goal adapter.
// Observation still uses agent-manager; writing never invokes that process.
func BoundedFileAgent(reader boundedrun.ExecutionAuthority, workspaces map[string]string, observer Adapter) (Adapter, error) {
	if reader == nil || len(workspaces) == 0 || observer == nil {
		return nil, fmt.Errorf("chain authority, workspace bindings and observer are required")
	}
	copied := map[string]string{}
	for instance, directory := range workspaces {
		if instance == "" || directory == "" {
			return nil, fmt.Errorf("instance workspace binding is required")
		}
		copied[instance] = directory
	}
	return &boundedFileAgent{reader: reader, workspaces: copied, observer: observer}, nil
}
func (a *boundedFileAgent) Supports(operation Operation) bool {
	if operation == OperationAssign {
		return true
	}
	if observer, ok := a.observer.(interface{ Supports(Operation) bool }); ok {
		return observer.Supports(operation)
	}
	return false
}
func (a *boundedFileAgent) run(ctx context.Context, request Request) (Response, error) {
	if request.Operation == OperationAssign {
		return Response{}, runError("unsupported_operation", fmt.Errorf("bounded tools require a signed command and this Host's confirmed attempt"))
	}
	return a.observer.run(ctx, request)
}
func (a *boundedFileAgent) runAuthorized(ctx context.Context, request Request, command nodecommand.NodeCommand, checkpoint *nodecommand.ChainExecution) (Response, error) {
	if request.Operation != OperationAssign {
		return a.run(ctx, request)
	}
	response := Response{SchemaVersion: SchemaVersion, Adapter: AdapterName, CommandID: request.CommandID, Operation: request.Operation, ObservedAt: time.Now().UTC().Format(time.RFC3339Nano)}
	if command.Budget != nil {
		response.Spend = &Spend{Asset: command.Budget.Asset, Known: true}
	}
	reject := func(reason string, err error) (Response, error) {
		response.Error = &Error{Code: reason, Message: err.Error()}
		return response, nil
	}
	if command.Budget == nil || command.Budget.Asset != "TOOL_CALLS" || request.Bounds == nil || request.Bounds.MaxCalls == 0 || request.Bounds.MaxCalls != command.Budget.Amount || checkpoint == nil || request.Params == nil {
		return reject("boundary_denied", fmt.Errorf("signed bounds, TOOL_CALLS budget and own confirmed checkpoint are required"))
	}
	workspace := a.workspaces[request.Agent]
	if workspace == "" {
		return reject("boundary_denied", fmt.Errorf("instance has no local workspace binding"))
	}
	task, err := boundedrun.ParseFileTask(request.Params.Task)
	if err != nil {
		return reject("boundary_denied", err)
	}
	guard, err := boundedrun.NewGuard(ctx, a.reader, command, *checkpoint, workspace)
	if err != nil {
		return reject("operation_unconfirmed", err)
	}
	deadline := time.UnixMilli(command.ExpiresAtMS)
	if request.TimeoutSeconds > 0 {
		requested := time.Now().Add(time.Duration(request.TimeoutSeconds * float64(time.Second)))
		if requested.Before(deadline) {
			deadline = requested
		}
	}
	ctx, cancel := context.WithDeadline(ctx, deadline)
	defer cancel()
	tools, err := boundedrun.OpenTools(boundedrun.Policy{Workspace: workspace, Paths: request.Bounds.Paths, MaxCalls: uint64(request.Bounds.MaxCalls), Deadline: deadline}, guard.Check)
	if err != nil {
		return reject("boundary_denied", err)
	}
	defer tools.Close()
	result := boundedrun.RunFileGoals(ctx, tools, task)
	response.Result, err = json.Marshal(result)
	if err != nil {
		return reject("operation_unconfirmed", err)
	}
	response.Spend.Amount = nodecommand.Uint64String(result.Used)
	response.OK = result.Status == "submitted"
	if !response.OK {
		code := result.Reason
		if code == "stopped" {
			code = "cancelled"
		}
		response.Error = &Error{Code: code, Message: "Native file Agent paused: " + result.Reason}
	}
	response.ObservedAt = time.Now().UTC().Format(time.RFC3339Nano)
	return response, nil
}
