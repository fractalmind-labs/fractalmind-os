package modelclient

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/boundedrun"
)

func TestOllamaQuestionAndPlannerUseBoundedDistinctFormats(t *testing.T) {
	t.Setenv("FM_OLLAMA_TEST_KEY", "isolated-not-a-real-key")
	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n := calls.Add(1)
		var p struct {
			Model    string                           `json:"model"`
			Stream   bool                             `json:"stream"`
			Format   json.RawMessage                  `json:"format"`
			Messages []struct{ Role, Content string } `json:"messages"`
			Options  struct {
				NumPredict int `json:"num_predict"`
			} `json:"options"`
			Tools json.RawMessage `json:"tools"`
		}
		if r.Method != "POST" || r.URL.Path != "/api/chat" || r.Header.Get("authorization") != "Bearer isolated-not-a-real-key" || r.Header.Get("x-api-key") != "" || r.Header.Get("anthropic-version") != "" || json.NewDecoder(r.Body).Decode(&p) != nil {
			t.Error("incorrect Ollama transport")
		}
		if p.Model != "fixture-model" || p.Stream || p.Options.NumPredict != 17 || p.Tools != nil || len(p.Messages) != 2 || p.Messages[0].Role != "system" || p.Messages[1].Role != "user" {
			t.Error("changed model, limits, tools or message roles")
		}
		text := "A proposal requiring Human review."
		if n == 1 {
			if len(p.Format) != 0 || p.Messages[1].Content != "exact signed question" {
				t.Error("question changed or forced to JSON")
			}
		} else {
			if len(p.Format) == 0 || p.Format[0] != '{' || !strings.Contains(p.Messages[1].Content, `"path":"output.md"`) {
				t.Error("planner lacks approved input or JSON encoding")
			}
			text = `{"call":{"action":"file.read","path":"output.md"}}`
		}
		body := map[string]any{"model": "fixture-model", "done": true, "done_reason": "stop", "message": map[string]any{"role": "assistant", "content": text}, "prompt_eval_count": 10, "eval_count": 7}
		json.NewEncoder(w).Encode(body)
	}))
	defer srv.Close()
	c, err := New(Config{Protocol: "ollama", APIBase: srv.URL, APIKeyEnv: "FM_OLLAMA_TEST_KEY", Model: "fixture-model", MaxTokens: 17})
	if err != nil {
		t.Fatal(err)
	}
	r, err := c.Answer(context.Background(), "exact signed question")
	if err != nil || r.Text != "A proposal requiring Human review." || r.Usage.InputTokens != 10 || r.Usage.OutputTokens != 7 || r.RequestID != "" {
		t.Fatal(r, err)
	}
	b, _ := json.Marshal(r)
	if strings.Contains(string(b), "isolated-not-a-real-key") {
		t.Fatal("credential leaked")
	}
	d, err := c.Next(context.Background(), boundedrun.PlanningContext{Task: boundedrun.FileTask{Files: []boundedrun.FileGoal{{Path: "output.md", Content: "approved"}}}})
	if err != nil || d.Call == nil || d.Call.Action != boundedrun.Read || d.Call.Path != "output.md" || calls.Load() != 2 {
		t.Fatal(d, err, calls.Load())
	}
}

func TestOllamaIncompleteUnsafeAndFailedRepliesNeverRetry(t *testing.T) {
	for _, mode := range []string{"http error", "redirect", "invalid JSON", "oversize", "missing usage", "negative usage", "truncated", "unfinished", "missing done", "wrong role", "tool call", "image", "empty text", "oversize text", "bad decision"} {
		t.Run(mode, func(t *testing.T) {
			var calls atomic.Int32
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				body := map[string]any{"model": "fixture", "done": true, "done_reason": "stop", "message": map[string]any{"role": "assistant", "content": "sensitive provider content"}, "prompt_eval_count": 1, "eval_count": 1}
				msg := body["message"].(map[string]any)
				switch mode {
				case "http error":
					w.WriteHeader(429)
					fmt.Fprint(w, "sensitive provider error")
					return
				case "redirect":
					w.Header().Set("Location", "/different-provider")
					w.WriteHeader(307)
					return
				case "invalid JSON":
					fmt.Fprint(w, "sensitive provider invalid JSON")
					return
				case "oversize":
					fmt.Fprint(w, strings.Repeat("x", (1<<20)+1))
					return
				case "missing usage":
					delete(body, "eval_count")
				case "negative usage":
					body["prompt_eval_count"] = -1
				case "truncated":
					body["done_reason"] = "length"
				case "unfinished":
					body["done"] = false
				case "missing done":
					delete(body, "done")
				case "wrong role":
					msg["role"] = "user"
				case "tool call":
					msg["tool_calls"] = []any{map[string]any{"function": "shell"}}
				case "image":
					msg["images"] = []string{"image"}
				case "empty text":
					msg["content"] = ""
				case "oversize text":
					msg["content"] = strings.Repeat("x", (16<<10)+1)
				case "bad decision":
					msg["content"] = `{"call":{"action":"file.read","path":"output.md"},"authority":"sensitive"}`
				}
				json.NewEncoder(w).Encode(body)
			}))
			defer srv.Close()
			c, err := New(Config{Protocol: "ollama", APIBase: srv.URL, Model: "fixture"})
			if err != nil {
				t.Fatal(err)
			}
			if mode == "bad decision" {
				_, err = c.Next(context.Background(), boundedrun.PlanningContext{})
			} else {
				_, err = c.Answer(context.Background(), "question")
			}
			if err == nil || calls.Load() != 1 || strings.Contains(err.Error(), "sensitive") {
				t.Fatal("failure retried or leaked", err, calls.Load())
			}
		})
	}
}

func TestOllamaCancelledRequestDoesNotRetry(t *testing.T) {
	started := make(chan struct{})
	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		// Consume the body so a client cancellation is observed by the server.
		var p any
		json.NewDecoder(r.Body).Decode(&p)
		close(started)
		<-r.Context().Done()
	}))
	defer srv.Close()
	c, err := New(Config{Protocol: "ollama", APIBase: srv.URL, Model: "fixture"})
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { _, e := c.Answer(ctx, "question"); done <- e }()
	<-started
	cancel()
	if err = <-done; err == nil || calls.Load() != 1 {
		t.Fatal(err, calls.Load())
	}
}

func TestModelProtocolDoesNotGuessOrDowngrade(t *testing.T) {
	if _, err := New(Config{Protocol: "unknown", APIBase: "http://127.0.0.1:1", Model: "m"}); err == nil {
		t.Fatal("unknown provider accepted")
	}
	if _, err := New(Config{Protocol: "ollama", APIBase: "http://example.com", Model: "m"}); err == nil {
		t.Fatal("remote HTTP accepted")
	}
}
