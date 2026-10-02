package runtimeadapter

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/agent"
	"io"
	"sync"
	"time"

	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/nodecommand"
)

var actionOperations = map[string]Operation{
	"inventory":    OperationInventory,
	"status":       OperationStatus,
	"start":        OperationStart,
	"stop":         OperationStop,
	"assign":       OperationAssign,
	"monitor":      OperationMonitor,
	"logs":         OperationLogs,
	"health":       OperationHealth,
	"availability": OperationAvailability,
}

type Executor struct {
	validator    *nodecommand.Validator
	adapter      Adapter
	now          func() time.Time
	store        ExecutionStore
	commandStore CommandExecutionStore

	mu       sync.Mutex
	inflight map[string]*flight
}

// Only the installed native adapter can publish these instances. Reading an
// inventory neither reserves a command nor runs the observer or a file goal.
func (e *Executor) NativeDiscovery() *agent.Discovery {
	if adapter, ok := e.adapter.(interface{ NativeDiscovery() *agent.Discovery }); ok {
		return adapter.NativeDiscovery()
	}
	return nil
}

type execution struct {
	response Response
	event    nodecommand.NodeEvent
	err      error
}

type flight struct {
	done chan struct{}
	execution
}

type payload struct {
	TimeoutSeconds float64                           `json:"timeout_seconds,omitempty"`
	Cancel         bool                              `json:"cancel,omitempty"`
	Restore        *bool                             `json:"restore,omitempty"`
	Task           string                            `json:"task,omitempty"`
	Lines          *int                              `json:"lines,omitempty"`
	Bounds         *ExecutionBounds                  `json:"bounds,omitempty"`
	Okr            *nodecommand.ExecutionContractRef `json:"okr,omitempty"`
	Measurement    *struct {
		Kind string `json:"kind"`
	} `json:"measurement,omitempty"`
	Handover     *nodecommand.HandoverProposal        `json:"handover_review,omitempty"`
	Continuation *nodecommand.HandoverContinuationRef `json:"handover_continue,omitempty"`
}

func NewExecutor(validator *nodecommand.Validator, adapter Adapter) *Executor {
	return NewExecutorWithStore(validator, adapter, newMemoryExecutionStore())
}

// NewExecutorWithStateDir persists execution results under stateDir so a
// restarted envd instance can replay the prior signed-command result without
// invoking the adapter again.
func NewExecutorWithStateDir(validator *nodecommand.Validator, adapter Adapter, stateDir string) (*Executor, error) {
	store, err := NewFileExecutionStore(stateDir)
	if err != nil {
		return nil, err
	}
	return NewExecutorWithStore(validator, adapter, store), nil
}

func NewExecutorWithStore(validator *nodecommand.Validator, adapter Adapter, store ExecutionStore) *Executor {
	if store == nil {
		store = newMemoryExecutionStore()
	}
	return &Executor{
		validator: validator,
		adapter:   adapter,
		now:       time.Now,
		store:     store,
		inflight:  make(map[string]*flight),
	}
}

func NewExecutorWithCommandStore(validator *nodecommand.Validator, adapter Adapter, store CommandExecutionStore) (*Executor, error) {
	if validator == nil || adapter == nil || store == nil {
		return nil, fmt.Errorf("validator, adapter and chain command result store are required")
	}
	executor := NewExecutorWithStore(validator, adapter, nil)
	executor.commandStore = store
	executor.store = nil
	return executor, nil
}

// Execute validates and reserves the signed command before invoking the local
// runtime. Exact concurrent replays wait for the first execution and reuse its
// evidence instead of invoking the lifecycle action again.
func (e *Executor) Execute(ctx context.Context, command nodecommand.NodeCommand) (Response, nodecommand.NodeEvent, error) {
	if e.validator == nil {
		return Response{}, nodecommand.NodeEvent{}, fmt.Errorf("node command validator is not configured")
	}
	if e.adapter == nil {
		return Response{}, nodecommand.NodeEvent{}, fmt.Errorf("runtime adapter is not configured")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	// Apply to every request before creating/waiting on an in-flight entry.
	// Otherwise a concurrent replay could claim a command its first caller
	// rejected before authorization.
	if adapter, ok := e.adapter.(interface{ Supports(Operation) bool }); ok && !adapter.Supports(actionOperations[command.Action]) {
		err := &nodecommand.RejectionError{Code: nodecommand.CodeRuntimeUnsupported, Message: "configured runtime cannot enforce the requested execution boundaries"}
		event, eventErr := e.commandRejectedEvent(command, err)
		if eventErr != nil {
			return Response{}, nodecommand.NodeEvent{}, eventErr
		}
		return Response{}, event, err
	}

	key := executionKey(command)
	e.mu.Lock()
	if current, ok := e.inflight[key]; ok {
		e.mu.Unlock()
		select {
		case <-ctx.Done():
			return Response{}, nodecommand.NodeEvent{}, ctx.Err()
		case <-current.done:
		}
		validation, err := e.validator.Validate(ctx, command)
		if err != nil {
			event, eventErr := e.commandRejectedEvent(command, err)
			if eventErr != nil {
				return Response{}, nodecommand.NodeEvent{}, eventErr
			}
			return Response{}, event, err
		}
		if !validation.Duplicate {
			result := e.executeReserved(ctx, command, key, validation.Execution)
			return result.response, result.event, result.err
		}
		result := current.execution
		result.response.Duplicate = true
		return result.response, result.event, result.err
	}
	current := &flight{done: make(chan struct{})}
	e.inflight[key] = current
	e.mu.Unlock()

	result := e.executeFirst(ctx, command, key)
	e.mu.Lock()
	current.execution = result
	delete(e.inflight, key)
	close(current.done)
	e.mu.Unlock()
	return result.response, result.event, result.err
}

func (e *Executor) executeFirst(ctx context.Context, command nodecommand.NodeCommand, key string) execution {
	if e.commandStore != nil {
		if err := e.commandStore.Preflight(ctx, command); err != nil {
			return execution{err: err}
		}
	}
	validation, err := e.validator.Validate(ctx, command)
	if err != nil {
		event, eventErr := e.commandRejectedEvent(command, err)
		if eventErr != nil {
			return execution{err: eventErr}
		}
		return execution{event: event, err: err}
	}
	if validation.Duplicate {
		var record ExecutionRecord
		var ok bool
		var loadErr error
		if e.commandStore != nil {
			record, ok, loadErr = e.commandStore.LoadCommand(ctx, command)
		} else {
			record, ok, loadErr = e.store.Load(ctx, key)
		}
		if loadErr != nil {
			return execution{err: fmt.Errorf("load prior runtime result: %w", loadErr)}
		}
		if !ok {
			return execution{err: &nodecommand.RejectionError{Code: nodecommand.CodeExecutionUnknown, Message: "authorized duplicate command result is unavailable; query the execution checkpoint before retry"}}
		}
		cached, loadErr := record.execution()
		if loadErr != nil {
			return execution{err: fmt.Errorf("decode prior runtime result: %w", loadErr)}
		}
		cached.response.Duplicate = true
		return cached
	}
	return e.executeReserved(ctx, command, key, validation.Execution)
}

func (e *Executor) executeReserved(ctx context.Context, command nodecommand.NodeCommand, key string, checkpoint *nodecommand.ChainExecution) execution {
	if e.commandStore != nil && (checkpoint == nil || checkpoint.State != 1 || len(checkpoint.AttemptID) != 64) {
		return execution{err: &nodecommand.RejectionError{Code: nodecommand.CodeUnauthorized, Message: "chain-confirmed start ownership is required before invoking the adapter"}}
	}
	if e.commandStore != nil {
		if err := e.commandStore.ConfirmStart(ctx, command, checkpoint); err != nil {
			return execution{err: err}
		}
	}
	operation, ok := actionOperations[command.Action]
	if !ok {
		return e.runtimeRejectedExecution(ctx, key, command, checkpoint, "", "unsupported_operation", fmt.Errorf("action %q has no runtime adapter mapping", command.Action))
	}
	var input payload
	if len(command.Payload) > 0 {
		decoder := json.NewDecoder(bytes.NewReader(command.Payload))
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&input); err != nil {
			return e.runtimeRejectedExecution(ctx, key, command, checkpoint, operation, "malformed_input", fmt.Errorf("decode runtime adapter payload: %w", err))
		}
		var trailing any
		if err := decoder.Decode(&trailing); err != io.EOF {
			if err == nil {
				err = fmt.Errorf("trailing JSON value")
			}
			return e.runtimeRejectedExecution(ctx, key, command, checkpoint, operation, "malformed_input", fmt.Errorf("decode runtime adapter payload: %w", err))
		}
	}
	params, err := operationParams(operation, input)
	if err != nil {
		return e.runtimeRejectedExecution(ctx, key, command, checkpoint, operation, "malformed_input", err)
	}
	request := Request{
		SchemaVersion:  SchemaVersion,
		CommandID:      command.CommandID,
		IdempotencyKey: command.IdempotencyKey,
		Operation:      operation,
		Agent:          command.Target.AgentID,
		TimeoutSeconds: input.TimeoutSeconds,
		Cancel:         input.Cancel,
		Params:         params,
		Bounds:         input.Bounds,
		Handover:       input.Handover,
	}
	if err := request.Validate(); err != nil {
		return e.runtimeRejectedExecution(ctx, key, command, checkpoint, operation, "malformed_input", err)
	}

	var response Response
	if adapter, ok := e.adapter.(interface {
		runAuthorized(context.Context, Request, nodecommand.NodeCommand, *nodecommand.ChainExecution) (Response, error)
	}); ok {
		response, err = adapter.runAuthorized(ctx, request, command, checkpoint)
	} else {
		if request.Handover != nil {
			return e.runtimeRejectedExecution(ctx, key, command, checkpoint, operation, "handover_unavailable", fmt.Errorf("adapter cannot accept native constraints"))
		}
		response, err = e.adapter.run(ctx, request)
	}
	if err != nil {
		response = Response{
			SchemaVersion: SchemaVersion,
			Adapter:       AdapterName,
			CommandID:     request.CommandID,
			Operation:     request.Operation,
			OK:            false,
			ObservedAt:    e.now().UTC().Format(time.RFC3339Nano),
			Error:         &Error{Code: RunErrorCode(err), Message: err.Error()},
		}
		event, eventErr := e.event(command, response)
		if eventErr != nil {
			return execution{err: eventErr}
		}
		result := execution{response: response, event: event, err: err}
		return e.persistExecution(ctx, command, key, checkpoint, result)
	}
	event, err := e.event(command, response)
	if err != nil {
		return execution{err: err}
	}
	result := execution{response: response, event: event}
	return e.persistExecution(ctx, command, key, checkpoint, result)
}

func (e *Executor) runtimeRejectedExecution(ctx context.Context, key string, command nodecommand.NodeCommand, checkpoint *nodecommand.ChainExecution, operation Operation, code string, err error) execution {
	resultErr := runError(code, err)
	response := Response{
		SchemaVersion: SchemaVersion,
		Adapter:       AdapterName,
		CommandID:     command.CommandID,
		Operation:     operation,
		OK:            false,
		ObservedAt:    e.now().UTC().Format(time.RFC3339Nano),
		Error:         &Error{Code: code, Message: err.Error()},
	}
	event, eventErr := e.runtimeRejectedEvent(command, operation, code)
	if eventErr != nil {
		return execution{err: eventErr}
	}
	result := execution{response: response, event: event, err: resultErr}
	return e.persistExecution(ctx, command, key, checkpoint, result)
}

func (e *Executor) persistExecution(ctx context.Context, command nodecommand.NodeCommand, key string, checkpoint *nodecommand.ChainExecution, result execution) execution {
	if e.commandStore != nil {
		record, err := e.commandStore.SaveCommand(ctx, command, checkpoint, recordFromExecution(result))
		if err != nil {
			result.err = errors.Join(result.err, fmt.Errorf("persist runtime result: %w", err))
			return result
		}
		restored, err := record.execution()
		if err != nil {
			result.err = errors.Join(result.err, err)
			return result
		}
		return restored
	}
	if err := e.store.Save(ctx, key, recordFromExecution(result)); err != nil {
		result.err = errors.Join(result.err, fmt.Errorf("persist runtime result: %w", err))
	}
	return result
}

func operationParams(operation Operation, input payload) (*OperationParams, error) {
	switch operation {
	case OperationStart:
		return &OperationParams{Restore: input.Restore}, nil
	case OperationAssign:
		return &OperationParams{Task: input.Task}, nil
	case OperationMonitor, OperationLogs:
		lines := DefaultLogLines
		if input.Lines != nil {
			lines = *input.Lines
		}
		follow := false
		return &OperationParams{Lines: &lines, Follow: &follow}, nil
	default:
		if input.Restore != nil || input.Task != "" || input.Lines != nil {
			return nil, fmt.Errorf("%s does not accept operation parameters", operation)
		}
		return nil, nil
	}
}

func (e *Executor) event(command nodecommand.NodeCommand, response Response) (nodecommand.NodeEvent, error) {
	evidence := struct {
		SchemaVersion string          `json:"schema_version"`
		Adapter       string          `json:"adapter"`
		CommandID     string          `json:"command_id"`
		Operation     Operation       `json:"operation"`
		OK            bool            `json:"ok"`
		Result        json.RawMessage `json:"result"`
		Error         *Error          `json:"error"`
	}{
		SchemaVersion: response.SchemaVersion,
		Adapter:       response.Adapter,
		CommandID:     response.CommandID,
		Operation:     response.Operation,
		OK:            response.OK,
		Result:        response.Result,
		Error:         response.Error,
	}
	data, err := json.Marshal(evidence)
	if err != nil {
		return nodecommand.NodeEvent{}, fmt.Errorf("marshal adapter evidence: %w", err)
	}
	sum := sha256.Sum256(data)
	hash := hex.EncodeToString(sum[:])
	commandHash := sha256.Sum256([]byte(executionKey(command)))
	return nodecommand.NodeEvent{
		Version:      nodecommand.ProtocolVersion,
		EventID:      "runtime-" + hex.EncodeToString(commandHash[:12]),
		CommandID:    command.CommandID,
		Target:       command.Target,
		Type:         "runtime_result",
		ResultCode:   ResultCode(response),
		ResultHash:   hash,
		EvidenceHash: hash,
		OccurredAtMS: e.now().UnixMilli(),
	}, nil
}

func (e *Executor) commandRejectedEvent(command nodecommand.NodeCommand, err error) (nodecommand.NodeEvent, error) {
	code := nodecommand.CodeOf(err)
	if code == "" {
		code = nodecommand.CodeUnauthorized
	}
	return e.rejectionEvent(command, "command_rejected", string(code), string(code), "")
}

func (e *Executor) runtimeRejectedEvent(command nodecommand.NodeCommand, operation Operation, code string) (nodecommand.NodeEvent, error) {
	return e.rejectionEvent(command, "runtime_rejected", "runtime_"+code, code, string(operation))
}

func (e *Executor) rejectionEvent(command nodecommand.NodeCommand, eventType, resultCode, evidenceCode, operation string) (nodecommand.NodeEvent, error) {
	evidence := struct {
		SchemaVersion     string                   `json:"schema_version"`
		CommandID         string                   `json:"command_id"`
		Target            nodecommand.Target       `json:"target"`
		Action            string                   `json:"action"`
		Scope             string                   `json:"scope"`
		CapabilityID      string                   `json:"capability_id"`
		RevocationVersion nodecommand.Uint64String `json:"revocation_version"`
		PayloadHash       string                   `json:"payload_hash"`
		EventType         string                   `json:"event_type"`
		ResultCode        string                   `json:"result_code"`
		Operation         string                   `json:"operation,omitempty"`
	}{
		SchemaVersion:     SchemaVersion,
		CommandID:         command.CommandID,
		Target:            command.Target,
		Action:            command.Action,
		Scope:             command.Scope,
		CapabilityID:      command.Capability.ID,
		RevocationVersion: command.Capability.RevocationVersion,
		PayloadHash:       command.PayloadHash,
		EventType:         eventType,
		ResultCode:        evidenceCode,
		Operation:         operation,
	}
	data, err := json.Marshal(evidence)
	if err != nil {
		return nodecommand.NodeEvent{}, fmt.Errorf("marshal rejection evidence: %w", err)
	}
	sum := sha256.Sum256(data)
	hash := hex.EncodeToString(sum[:])
	commandHash := sha256.Sum256([]byte(executionKey(command)))
	return nodecommand.NodeEvent{
		Version:      nodecommand.ProtocolVersion,
		EventID:      "runtime-" + hex.EncodeToString(commandHash[:12]),
		CommandID:    command.CommandID,
		Target:       command.Target,
		Type:         eventType,
		ResultCode:   resultCode,
		ResultHash:   hash,
		EvidenceHash: hash,
		OccurredAtMS: e.now().UnixMilli(),
	}, nil
}

func executionKey(command nodecommand.NodeCommand) string {
	key := command.Signer + "\x00" + command.Capability.ID + "\x00" + command.CommandID
	bytes, err := command.SigningBytes()
	if err != nil {
		return key + "\x00invalid"
	}
	hash := sha256.Sum256(bytes)
	return key + "\x00" + hex.EncodeToString(hash[:])
}

func ResultCode(response Response) string {
	if response.OK {
		return "runtime_ok"
	}
	if response.Error == nil || response.Error.Code == "" {
		return "runtime_internal_error"
	}
	return "runtime_" + response.Error.Code
}
