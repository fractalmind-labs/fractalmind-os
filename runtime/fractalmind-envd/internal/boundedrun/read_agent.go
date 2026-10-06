package boundedrun

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
)

type ReadTask struct {
	Kind  string   `json:"kind"`
	Paths []string `json:"paths"`
}
type ReadOutcome struct {
	Status  string   `json:"status"`
	Reason  string   `json:"reason,omitempty"`
	Used    uint64   `json:"tool_calls_used"`
	Results []Result `json:"results"`
}

func ParseReadTask(raw string) (ReadTask, error) {
	var task ReadTask
	d := json.NewDecoder(bytes.NewBufferString(raw))
	d.DisallowUnknownFields()
	if err := d.Decode(&task); err != nil {
		return task, err
	}
	var extra any
	if err := d.Decode(&extra); err != io.EOF {
		return task, fmt.Errorf("trailing read task JSON")
	}
	if task.Kind != "inspect_text_files" || len(task.Paths) == 0 || len(task.Paths) > 3 {
		return task, fmt.Errorf("native file Agent reads one to three text files")
	}
	seen := map[string]bool{}
	for _, path := range task.Paths {
		if !validPath(path, false) || seen[path] {
			return task, ErrBoundary
		}
		seen[path] = true
	}
	return task, nil
}

func ReadFiles(ctx context.Context, tools *Tools, task ReadTask) ReadOutcome {
	out := ReadOutcome{Status: "submitted", Results: []Result{}}
	for i, path := range task.Paths {
		result, err := tools.Call(ctx, Call{ID: fmt.Sprintf("direct-read-%d", i), Action: Read, Path: path})
		if err != nil {
			out.Status, out.Reason = "blocked", reason(err)
			break
		}
		out.Results = append(out.Results, result)
	}
	out.Used = tools.Used()
	return out
}
