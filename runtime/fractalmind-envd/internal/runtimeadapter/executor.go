package runtimeadapter

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"sync"
	"time"

	"github.com/fractalmind-ai/fractalmind-envd/internal/nodecommand"
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
	validator *nodecommand.Validator
	adapter   Adapter
	now       func() time.Time
	store     ExecutionStore

	mu       sync.Mutex
	inflight map[string]*flight
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
	TimeoutSeconds float64 `json:"timeout_seconds,omitempty"`
	Cancel         bool    `json:"cancel,omitempty"`
	Restore        *bool   `json:"restore,omitempty"`
	Task           string  `json:"task,omitempty"`
	Lines          *int    `json:"lines,omitempty"`
}

func NewExecutor(validator *nodecommand.Validator, adapter Adapter) *Executor {
	return NewExecutorWithStore(validator, adapter, newMemoryExecutionStore())
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
			return Response{}, nodecommand.NodeEvent{}, err
		}
		if !validation.Duplicate {
			result := e.executeReserved(ctx, command, key)
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
	validation, err := e.validator.Validate(ctx, command)
	if err != nil {
		return execution{err: err}
	}
	if validation.Duplicate {
		record, ok, loadErr := e.store.Load(ctx, key)
		if loadErr != nil {
			return execution{err: fmt.Errorf("load prior runtime result: %w", loadErr)}
		}
		if !ok {
			return execution{err: fmt.Errorf("authorized duplicate command result is unavailable")}
		}
		cached, loadErr := record.execution()
		if loadErr != nil {
			return execution{err: fmt.Errorf("decode prior runtime result: %w", loadErr)}
		}
		cached.response.Duplicate = true
		return cached
	}
	return e.executeReserved(ctx, command, key)
}

func (e *Executor) executeReserved(ctx context.Context, command nodecommand.NodeCommand, key string) execution {
	operation, ok := actionOperations[command.Action]
	if !ok {
		return execution{err: fmt.Errorf("action %q has no runtime adapter mapping", command.Action)}
	}
	var input payload
	if len(command.Payload) > 0 {
		decoder := json.NewDecoder(bytes.NewReader(command.Payload))
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&input); err != nil {
			return execution{err: fmt.Errorf("decode runtime adapter payload: %w", err)}
		}
		var trailing any
		if err := decoder.Decode(&trailing); err != io.EOF {
			if err == nil {
				err = fmt.Errorf("trailing JSON value")
			}
			return execution{err: fmt.Errorf("decode runtime adapter payload: %w", err)}
		}
	}
	params, err := operationParams(operation, input)
	if err != nil {
		return execution{err: err}
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
	}
	if err := request.Validate(); err != nil {
		return execution{err: err}
	}

	response, err := e.adapter.run(ctx, request)
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
		if storeErr := e.store.Save(ctx, key, recordFromExecution(result)); storeErr != nil {
			result.err = errors.Join(err, fmt.Errorf("persist runtime result: %w", storeErr))
		}
		return result
	}
	event, err := e.event(command, response)
	if err != nil {
		return execution{err: err}
	}
	result := execution{response: response, event: event}
	if err := e.store.Save(ctx, key, recordFromExecution(result)); err != nil {
		result.err = fmt.Errorf("persist runtime result: %w", err)
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

func executionKey(command nodecommand.NodeCommand) string {
	return command.Signer + "\x00" + command.Capability.ID + "\x00" + command.CommandID
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
