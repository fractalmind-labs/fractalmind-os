package runtimeadapter

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/agent"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/boundedrun"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/nodecommand"
)

type boundedFileAgent struct {
	reader      boundedrun.ExecutionAuthority
	workspaces  map[string]string
	observer    Adapter
	inventory   *agent.NativeInventory
	instanceIDs map[string]string
	mu          sync.Mutex
	active      map[string]nativeAttempt
	reviews     map[string]*nativeReviewLease
}

// BoundedFileAgent supports an explicit, measurable native file-goal adapter.
// Native status is physical activity; other observations use agent-manager.
// Writing never invokes that process.
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
	inventory, aliases, err := agent.NewNativeInventory(copied)
	if err != nil {
		return nil, err
	}
	for id, path := range aliases {
		if _, exists := copied[id]; exists {
			return nil, fmt.Errorf("native instance alias collides with configured binding")
		}
		copied[id] = path
	}
	instanceIDs := map[string]string{}
	for _, instance := range inventory.Discover().Instances {
		instanceIDs[instance.InstanceID] = instance.InstanceID
		instanceIDs[instance.Session] = instance.InstanceID
		copied[instance.Session] = instance.Workspace
	}
	return &boundedFileAgent{reader: reader, workspaces: copied, observer: observer, inventory: inventory, instanceIDs: instanceIDs, active: map[string]nativeAttempt{}, reviews: map[string]*nativeReviewLease{}}, nil
}

func (a *boundedFileAgent) NativeDiscovery() *agent.Discovery {
	d := a.inventory.Discover()
	return &d
}
func (a *boundedFileAgent) Supports(operation Operation) bool {
	if operation == OperationAssign || operation == OperationStatus || operation == OperationAvailability {
		return true
	}
	if observer, ok := a.observer.(interface{ Supports(Operation) bool }); ok {
		return observer.Supports(operation)
	}
	return false
}
func (a *boundedFileAgent) run(ctx context.Context, request Request) (Response, error) {
	if request.Handover != nil {
		return Response{}, runError("handover_unavailable", fmt.Errorf("review requires a signed, prepared chain status command"))
	}
	if (request.Operation == OperationStatus || request.Operation == OperationAvailability) && (a.workspaces[request.Agent] != "" || strings.HasPrefix(request.Agent, "native-")) {
		return a.nativeStatus(request)
	}
	if request.Operation == OperationAssign {
		return Response{}, runError("unsupported_operation", fmt.Errorf("bounded tools require a signed command and this Host's confirmed attempt"))
	}
	return a.observer.run(ctx, request)
}
func (a *boundedFileAgent) runAuthorized(ctx context.Context, request Request, command nodecommand.NodeCommand, checkpoint *nodecommand.ChainExecution) (Response, error) {
	if request.Handover != nil {
		return a.reviewHandover(ctx, request, command, checkpoint)
	}
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
	var workspaceIdentity os.FileInfo
	if workspace == "" {
		return reject("boundary_denied", fmt.Errorf("instance has no local workspace binding"))
	}
	if a.instanceIDs[request.Agent] == "" {
		return reject("workspace_changed", fmt.Errorf("native instance continuity is unavailable"))
	}
	if id := a.instanceIDs[request.Agent]; id != "" {
		scan := a.inventory.Discover()
		present := false
		for _, instance := range scan.Instances {
			if instance.InstanceID == id && instance.Workspace == workspace {
				present = true
			}
		}
		if scan.State != "complete" || !present {
			return reject("workspace_changed", fmt.Errorf("native instance or original workspace is no longer present"))
		}
		workspaceIdentity = a.inventory.WorkspaceIdentity(id)
		if workspaceIdentity == nil {
			return reject("workspace_changed", fmt.Errorf("original directory identity is unavailable"))
		}
	}
	task, err := boundedrun.ParseFileTask(request.Params.Task)
	if err != nil {
		return reject("boundary_denied", err)
	}
	release, available := a.beginNative(request.Agent, request.CommandID, checkpoint.ID)
	if !available {
		return reject("instance_busy", fmt.Errorf("native instance has a physical execution or pending constraint review; check it before continuing"))
	}
	defer release()
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
	check := guard.Check
	if workspaceIdentity != nil {
		check = func(ctx context.Context) error {
			info, err := os.Stat(workspace)
			if err != nil || !os.SameFile(info, workspaceIdentity) {
				return boundedrun.ErrConflict
			}
			return guard.Check(ctx)
		}
	}
	tools, err := boundedrun.OpenTools(boundedrun.Policy{Workspace: workspace, WorkspaceIdentity: workspaceIdentity, Paths: request.Bounds.Paths, MaxCalls: uint64(request.Bounds.MaxCalls), Deadline: deadline}, check)
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
