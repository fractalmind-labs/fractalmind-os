package modelclient

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/boundedrun"
)

func TestPlannerSeesLatestWriteWithoutLosingMissingFileHistory(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var p struct{ Messages []struct{ Content string } }
		if json.NewDecoder(r.Body).Decode(&p) != nil || len(p.Messages) != 2 {
			t.Error("invalid planner request")
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		var input struct {
			boundedrun.PlanningContext
			Latest map[string]boundedrun.Observation `json:"latest_host_observations"`
		}
		if json.Unmarshal([]byte(p.Messages[1].Content), &input) != nil {
			t.Error("invalid planner context")
		}
		if len(input.Observations) != 2 || input.Observations[0].Error != "file_missing" || input.Latest["approved.md"].Error != "" || input.Latest["approved.md"].Result.Action != boundedrun.Write || input.Task.Files[0].Content != "approved content" {
			t.Error("latest state lost, stale error reused or goal changed")
		}
		fmt.Fprint(w, `{"model":"fixture","message":{"role":"assistant","content":"{\"call\":{\"action\":\"file.read\",\"path\":\"approved.md\"}}"},"done":true,"done_reason":"stop","prompt_eval_count":1,"eval_count":1}`)
	}))
	defer srv.Close()
	c, err := New(Config{Protocol: "ollama", APIBase: srv.URL, Model: "fixture"})
	if err != nil {
		t.Fatal(err)
	}
	d, err := c.Next(context.Background(), boundedrun.PlanningContext{Task: boundedrun.FileTask{Files: []boundedrun.FileGoal{{Path: "approved.md", Content: "approved content"}}}, Observations: []boundedrun.Observation{{Result: boundedrun.Result{Action: boundedrun.Read, Path: "approved.md"}, Error: "file_missing"}, {Result: boundedrun.Result{Action: boundedrun.Write, Path: "approved.md"}}}})
	if err != nil || d.Call == nil || d.Call.Action != boundedrun.Read {
		t.Fatal(d, err)
	}
}
