package runtimeadapter

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"

	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/boundedrun"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/modelclient"
)

func modelFixture(t *testing.T, answer func(string) string) (*modelclient.Client, *atomic.Int32) {
	t.Helper()
	calls := &atomic.Int32{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		var p struct {
			Messages []struct{ Content string } `json:"messages"`
		}
		if err := json.NewDecoder(r.Body).Decode(&p); err != nil || len(p.Messages) != 1 {
			t.Error("invalid model input")
			w.WriteHeader(400)
			return
		}
		result := answer(p.Messages[0].Content)
		if result == "HTTP_ERROR" {
			w.WriteHeader(503)
			return
		}
		text, _ := json.Marshal(result)
		fmt.Fprintf(w, `{"type":"message","role":"assistant","model":"synthetic-fixture","stop_reason":"end_turn","content":[{"type":"text","text":%s}],"usage":{"input_tokens":1,"output_tokens":1}}`, text)
	}))
	t.Cleanup(srv.Close)
	c, err := modelclient.New(modelclient.Config{APIBase: srv.URL, Model: "synthetic-fixture"})
	if err != nil {
		t.Fatal(err)
	}
	return c, calls
}

func TestNativeQuestionIsAuthorizedZeroToolAndDoesNotInterruptOKR(t *testing.T) {
	a, p, observer, r, c, dir := directNativeFixture(t, "ask", "", 0)
	a.model, _ = modelFixture(t, func(message string) string {
		if message != r.Message {
			t.Error("message substitution")
		}
		return "A plan for review, not executed."
	})
	release, ok := a.beginNative("files", "okr-running", "okr-run")
	if !ok {
		t.Fatal("physical slot")
	}
	defer release()
	response, err := a.runAuthorized(context.Background(), r, c, &p.run)
	var result struct {
		Schema   string            `json:"schema"`
		Verified bool              `json:"verified"`
		Reply    modelclient.Reply `json:"reply"`
	}
	entries, _ := os.ReadDir(dir)
	if err != nil || !response.OK || response.Validate(r) != nil || response.Spend != nil || json.Unmarshal(response.Result, &result) != nil || result.Schema != "fractalmind.model-reply.v1" || result.Verified || result.Reply.Text != "A plan for review, not executed." || len(entries) != 0 || observer.callCount() != 0 || physicalState(t, a, r.Agent).ActiveCommandID != "okr-running" {
		t.Fatalf("unsafe question: %+v %v", response, err)
	}
}

func TestNativeQuestionFailureNeverReplaysOrExposesStaleReply(t *testing.T) {
	for _, mode := range []string{"no provider", "provider failure", "stop during reply", "signed message changed", "workspace changed during reply"} {
		t.Run(mode, func(t *testing.T) {
			a, p, observer, r, c, dir := directNativeFixture(t, "ask", "", 0)
			var calls *atomic.Int32
			if mode != "no provider" {
				a.model, calls = modelFixture(t, func(string) string {
					if mode == "workspace changed during reply" {
						if err := os.Rename(dir, dir+"-old"); err != nil {
							t.Error(err)
						}
						if err := os.Mkdir(dir, 0700); err != nil {
							t.Error(err)
						}
					}
					if mode == "provider failure" {
						return "HTTP_ERROR"
					}
					return "private stale reply"
				})
			}
			if mode == "workspace changed during reply" {
				t.Cleanup(func() { os.RemoveAll(dir + "-old") })
			}
			if mode == "stop during reply" {
				p.stopAt = 2
			}
			if mode == "signed message changed" {
				r.Message = "substituted"
			}
			response, err := a.runAuthorized(context.Background(), r, c, &p.run)
			if err != nil || response.OK || response.Error == nil || len(response.Result) != 0 || response.Spend != nil || observer.callCount() != 0 {
				t.Fatal(response, err)
			}
			if mode == "stop during reply" && response.Error.Code != "cancelled" {
				t.Fatal("observed stop was not acknowledged", response)
			}
			if calls != nil && calls.Load() > 1 {
				t.Fatal("automatic retry")
			}
			if mode == "signed message changed" && calls.Load() != 0 {
				t.Fatal("unsigned message sent to provider")
			}
		})
	}
}

func TestNativeOKRModelStrategyDoesNotFirstRunDeterministicTask(t *testing.T) {
	for _, mode := range []string{"actual model selected tools", "model failure", "model asks changed goal"} {
		t.Run(mode, func(t *testing.T) {
			a, p, observer, id, dir := nativeFixture(t)
			r, c := nativeAssignment(t, p, id, dir)
			var calls *atomic.Int32
			a.model, calls = modelFixture(t, func(input string) string {
				if mode == "model failure" {
					return "HTTP_ERROR"
				}
				if mode == "model asks changed goal" {
					return `{"call":{"action":"file.write","path":"actual.md","content":"forged"}}`
				}
				var ctx boundedrun.PlanningContext
				if err := json.Unmarshal([]byte(input), &ctx); err != nil {
					t.Error(err)
					return `{"stop":"invalid context"}`
				}
				if len(ctx.Observations) == 1 {
					return `{"call":{"action":"file.write","path":"actual.md","content":"attained"}}`
				}
				return `{"call":{"action":"file.read","path":"actual.md"}}`
			})
			response, err := a.runAuthorized(context.Background(), r, c, &p.run)
			if err != nil || response.Validate(r) != nil || observer.callCount() != 0 || len(a.active) != 0 {
				t.Fatal(response, err)
			}
			content, readErr := os.ReadFile(filepath.Join(dir, "actual.md"))
			if mode == "actual model selected tools" {
				if !response.OK || response.Spend.Amount != 3 || string(content) != "attained" || calls.Load() != 3 {
					t.Fatal("actual model path did not execute", response, calls.Load(), readErr)
				}
			} else if response.OK || response.Spend.Amount != 0 || !os.IsNotExist(readErr) || calls.Load() != 1 {
				t.Fatal("failed model executed fallback or replayed", response, calls.Load(), readErr)
			}
		})
	}
}
