package boundedrun

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
)

// PlanningContext contains the approved task and actual Host observations.
// Neither a planner response nor its prose is execution authority or evidence.
type PlanningContext struct {
	Task           FileTask      `json:"approved_task"`
	RemainingCalls uint64        `json:"remaining_tool_calls"`
	Observations   []Observation `json:"host_observations"`
}
type Observation struct {
	Result Result `json:"result"`
	Error  string `json:"error,omitempty"`
}
type Decision struct {
	Call *Call  `json:"call,omitempty"`
	Stop string `json:"stop,omitempty"`
}
type Planner interface {
	Next(context.Context, PlanningContext) (Decision, error)
}

func ParseDecision(raw string) (Decision, error) {
	var d Decision
	if len(raw) > 128<<10 {
		return d, ErrBoundary
	}
	decoder := json.NewDecoder(bytes.NewBufferString(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&d); err != nil {
		return d, err
	}
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		return d, fmt.Errorf("trailing planner data")
	}
	if (d.Call == nil) == (d.Stop == "") || len(d.Stop) > 1024 {
		return d, ErrBoundary
	}
	return d, nil
}

// RunPlannedFileGoals allows a configured model to choose the next action.
// The Host still checks the approved exact goal, the tool's directory handles,
// current chain authority and budget. Only actual file reads produce evidence.
func RunPlannedFileGoals(ctx context.Context, tools *Tools, task FileTask, planner Planner, maxRequests int, check Check) Outcome {
	out := Outcome{Status: "blocked", Evidence: []FileEvidence{}}
	finish := func(reason string, blocked string) Outcome {
		out.Reason, out.BlockedPath, out.Used = reason, blocked, tools.Used()
		out.Evidence = out.Evidence[:0]
		return out
	}
	if planner == nil || check == nil || maxRequests < 1 || maxRequests > 32 {
		return finish("model_unavailable", "")
	}
	// Revalidate caller-created tasks with the same parser used for signed tasks.
	raw, err := json.Marshal(task)
	if err != nil {
		return finish("boundary_denied", "")
	}
	task, err = ParseFileTask(string(raw))
	if err != nil {
		return finish("boundary_denied", "")
	}
	goals := map[string]FileGoal{}
	measured := map[string]Result{}
	for _, goal := range task.Files {
		goals[goal.Path] = goal
	}
	observations := []Observation{}
	for step := 0; step < maxRequests; step++ {
		if err := ctx.Err(); err != nil {
			return finish(reason(err), "")
		}
		if err := check(ctx); err != nil {
			return finish(reason(err), "")
		}
		if tools.Used() >= tools.policy.MaxCalls {
			return finish("budget_exhausted", "")
		}
		// A provider receives copies, never writable references to the approval.
		input := PlanningContext{Task: FileTask{Kind: task.Kind, Files: append([]FileGoal(nil), task.Files...)}, RemainingCalls: tools.policy.MaxCalls - tools.Used(), Observations: append([]Observation{}, observations...)}
		d, err := planner.Next(ctx, input)
		if err != nil {
			if ctx.Err() != nil {
				return finish(reason(ctx.Err()), "")
			}
			return finish("model_unavailable", "")
		}
		// A revocation/stop while the model was thinking invalidates its response.
		if err := check(ctx); err != nil {
			return finish(reason(err), "")
		}
		if d.Call == nil || d.Stop != "" {
			return finish("model_stopped", "")
		}
		call := *d.Call
		goal, exists := goals[call.Path]
		if !exists || (call.Action != Read && call.Action != Write) || (call.Action == Write && call.Content != goal.Content) {
			return finish("boundary_denied", call.Path)
		}
		// Model IDs cannot alias a prior call or make it appear to be a new observation.
		call.ID = fmt.Sprintf("model-step-%d", step+1)
		result, err := tools.Call(ctx, call)
		observation := Observation{Result: result}
		if err != nil {
			if errors.Is(err, fs.ErrNotExist) && call.Action == Read {
				observation.Error = "file_missing"
			} else {
				return finish(reason(err), call.Path)
			}
		}
		observations = append(observations, observation)
		delete(measured, call.Path)
		if err == nil && call.Action == Read && result.Hash == contentHash([]byte(goal.Content)) {
			measured[call.Path] = result
		}
		if len(measured) == len(goals) {
			out.Status, out.Reason, out.Used = "submitted", "", tools.Used()
			for _, goal := range task.Files {
				measurement := measured[goal.Path]
				out.Evidence = append(out.Evidence, FileEvidence{Path: goal.Path, ExpectedHash: contentHash([]byte(goal.Content)), ObservedHash: measurement.Hash, Verified: true, ObservedAt: measurement.ObservedAt})
			}
			return out
		}
	}
	return finish("model_limit", "")
}
