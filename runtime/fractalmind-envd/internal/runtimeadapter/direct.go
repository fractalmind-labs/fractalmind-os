package runtimeadapter

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"reflect"
	"time"

	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/boundedrun"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/nodecommand"
)

// The native file adapter owns its physical instance and supports explicit file
// tasks. It does not forward arbitrary text to an unbounded shell or observer.
func (a *boundedFileAgent) runDirect(ctx context.Context, request Request, command nodecommand.NodeCommand, run *nodecommand.ChainExecution) (Response, error) {
	response := Response{SchemaVersion: SchemaVersion, Adapter: AdapterName, CommandID: request.CommandID, Operation: request.Operation, ObservedAt: time.Now().UTC().Format(time.RFC3339Nano)}
	if command.Budget != nil {
		response.Spend = &Spend{Asset: command.Budget.Asset, Known: true}
	}
	reject := func(code string, err error) (Response, error) {
		response.Error = &Error{Code: code, Message: err.Error()}
		return response, nil
	}
	if err := request.Validate(); err != nil {
		return reject("boundary_denied", err)
	}
	if run == nil || run.Direct == nil || command.Action != "direct.message" || request.Agent != command.Target.AgentID || request.CommandID != command.CommandID {
		return reject("boundary_denied", fmt.Errorf("exact signed direct Run and fixed instance are required"))
	}
	state, err := a.reader.Resolve(ctx, command.Capability)
	if err != nil {
		return reject("operation_unconfirmed", err)
	}
	p, err := nodecommand.ParseDirectRequest(command, state.Direct)
	if err != nil {
		return reject("boundary_denied", err)
	}
	if request.Message != p.Message || request.Params.Task != p.Task || *request.Direct != *p.Direct || request.Bounds.MaxCalls != p.Bounds.MaxCalls || !reflect.DeepEqual(request.Bounds.Paths, p.Bounds.Paths) {
		return reject("boundary_denied", fmt.Errorf("adapter input differs from signed message"))
	}
	workspace, id := a.workspaces[request.Agent], a.instanceIDs[request.Agent]
	if workspace == "" || id == "" {
		return reject("workspace_changed", fmt.Errorf("fixed native instance is not available"))
	}
	scan, present := a.inventory.Discover(), false
	for _, instance := range scan.Instances {
		if instance.InstanceID == id && instance.Workspace == workspace {
			present = true
		}
	}
	identity := a.inventory.WorkspaceIdentity(id)
	if scan.State != "complete" || !present || identity == nil {
		return reject("workspace_changed", fmt.Errorf("original fixed instance or workspace is no longer present"))
	}
	if p.Direct.Action == "file.read" || p.Direct.Action == "file.write" {
		release, available := a.beginNative(request.Agent, request.CommandID, run.ID)
		if !available {
			return reject("instance_busy", fmt.Errorf("physical instance is running or awaiting a constraint review"))
		}
		defer release()
	}
	guard, err := boundedrun.NewGuard(ctx, a.reader, command, *run, workspace)
	if err != nil {
		return reject("operation_unconfirmed", err)
	}
	switch p.Direct.Action {
	case "status":
		status, err := a.nativeStatus(Request{SchemaVersion: SchemaVersion, CommandID: request.CommandID, Operation: OperationStatus, Agent: request.Agent})
		if err != nil {
			return reject("operation_unconfirmed", err)
		}
		response.OK, response.Result, response.Error = status.OK, status.Result, status.Error
		return response, nil
	case "ask":
		return reject("unsupported_operation", fmt.Errorf("this native file adapter supports status and explicit file tasks; conversational model execution is unavailable"))
	case "file.read", "file.write":
	default:
		return reject("unsupported_operation", fmt.Errorf("unsupported direct action"))
	}
	deadline := time.UnixMilli(command.ExpiresAtMS)
	ctx, cancel := context.WithDeadline(ctx, deadline)
	defer cancel()
	paths := p.Bounds.Paths
	if p.Direct.Action == "file.read" {
		// Read messages cannot acquire write handles even when their permission
		// boundary describes both actions.
		paths = map[string][]string{boundedrun.Read: append([]string(nil), paths[boundedrun.Read]...)}
	}
	check := func(ctx context.Context) error {
		info, err := os.Stat(workspace)
		if err != nil || !os.SameFile(info, identity) {
			return boundedrun.ErrConflict
		}
		return guard.Check(ctx)
	}
	tools, err := boundedrun.OpenTools(boundedrun.Policy{Workspace: workspace, WorkspaceIdentity: identity, Paths: paths, MaxCalls: uint64(p.Bounds.MaxCalls), Deadline: deadline}, check)
	if err != nil {
		return reject("boundary_denied", err)
	}
	defer tools.Close()
	var result any
	var status, reason string
	if p.Direct.Action == "file.read" {
		task, err := boundedrun.ParseReadTask(p.Task)
		if err != nil {
			return reject("boundary_denied", err)
		}
		out := boundedrun.ReadFiles(ctx, tools, task)
		result, status, reason = out, out.Status, out.Reason
	} else {
		task, err := boundedrun.ParseFileTask(p.Task)
		if err != nil {
			return reject("boundary_denied", err)
		}
		out := boundedrun.RunFileGoals(ctx, tools, task)
		result, status, reason = out, out.Status, out.Reason
	}
	response.Spend.Amount = nodecommand.Uint64String(tools.Used())
	response.Result, err = json.Marshal(result)
	if err != nil {
		return reject("operation_unconfirmed", err)
	}
	response.OK = status == "submitted"
	if !response.OK {
		if reason == "stopped" {
			reason = "cancelled"
		}
		response.Error = &Error{Code: reason, Message: "Native direct file task paused: " + reason}
	}
	response.ObservedAt = time.Now().UTC().Format(time.RFC3339Nano)
	return response, nil
}
