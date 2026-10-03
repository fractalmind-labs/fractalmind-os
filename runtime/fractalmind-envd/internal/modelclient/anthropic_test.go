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

func TestConfiguredModelSendsExactTextWithoutToolsOrSecretsInResults(t *testing.T) {
	t.Setenv("FM_MODEL_TEST_KEY", "isolated-not-a-real-key")
	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		var p map[string]any
		if r.Method != "POST" || r.URL.Path != "/v1/messages" || r.Header.Get("x-api-key") != "isolated-not-a-real-key" || r.Header.Get("anthropic-version") != "2023-06-01" || json.NewDecoder(r.Body).Decode(&p) != nil {
			t.Error("incorrect Messages API transport")
		}
		if _, ok := p["tools"]; ok {
			t.Error("provider tools enabled")
		}
		if p["model"] != "fixture-model" || p["max_tokens"] != float64(17) || p["messages"].([]any)[0].(map[string]any)["content"] != "exact signed question" {
			t.Error("changed question/limits")
		}
		w.Header().Set("request-id", "fixture-request")
		fmt.Fprint(w, `{"type":"message","role":"assistant","model":"fixture-model","stop_reason":"end_turn","content":[{"type":"text","text":"A proposal, not an observation."}],"usage":{"input_tokens":10,"output_tokens":7}}`)
	}))
	defer srv.Close()
	c, err := New(Config{APIBase: srv.URL, APIKeyEnv: "FM_MODEL_TEST_KEY", Model: "fixture-model", MaxTokens: 17})
	if err != nil {
		t.Fatal(err)
	}
	reply, err := c.Answer(context.Background(), "exact signed question")
	if err != nil || reply.Text != "A proposal, not an observation." || reply.Usage.InputTokens != 10 || reply.RequestID != "fixture-request" || calls.Load() != 1 {
		t.Fatal(reply, err)
	}
	data, _ := json.Marshal(reply)
	if strings.Contains(string(data), "isolated-not-a-real-key") {
		t.Fatal("credential in result")
	}
}

func TestModelFailureTruncationToolsAndRedirectNeverRetry(t *testing.T) {
	for _, mode := range []string{"http error", "truncation", "tool use", "redirect", "invalid JSON", "oversize", "missing usage", "oversize text"} {
		t.Run(mode, func(t *testing.T) {
			var calls atomic.Int32
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				switch mode {
				case "http error":
					w.WriteHeader(429)
					fmt.Fprint(w, "sensitive secret provider error")
				case "redirect":
					w.Header().Set("Location", "/different-provider")
					w.WriteHeader(307)
				case "invalid JSON":
					fmt.Fprint(w, "sensitive bad JSON")
				case "oversize":
					fmt.Fprint(w, strings.Repeat("x", (1<<20)+1))
				case "missing usage":
					fmt.Fprint(w, `{"type":"message","role":"assistant","model":"fixture","stop_reason":"end_turn","content":[{"type":"text","text":"no usage"}]}`)
				case "oversize text":
					text, _ := json.Marshal(strings.Repeat("x", (16<<10)+1))
					fmt.Fprintf(w, `{"type":"message","role":"assistant","model":"fixture","stop_reason":"end_turn","content":[{"type":"text","text":%s}],"usage":{"input_tokens":1,"output_tokens":1}}`, text)
				default:
					stop, kind := "max_tokens", "text"
					if mode == "tool use" {
						stop, kind = "end_turn", "tool_use"
					}
					fmt.Fprintf(w, `{"type":"message","role":"assistant","model":"fixture","stop_reason":%q,"content":[{"type":%q,"text":"bad"}],"usage":{"input_tokens":1,"output_tokens":1}}`, stop, kind)
				}
			}))
			defer srv.Close()
			c, err := New(Config{APIBase: srv.URL, Model: "fixture"})
			if err != nil {
				t.Fatal(err)
			}
			_, err = c.Answer(context.Background(), "question")
			if err == nil || calls.Load() != 1 || strings.Contains(err.Error(), "sensitive") {
				t.Fatal("failure retried or leaked", err, calls.Load())
			}
		})
	}
}

func TestModelConfigurationRequiresExplicitProviderAndFiniteLimits(t *testing.T) {
	for _, cfg := range []Config{{APIBase: "http://example.com", Model: "m"}, {APIBase: "https://user:secret@example.com", Model: "m"}, {APIBase: "https://example.com?secret=1", Model: "m"}, {APIBase: "https://example.com", Model: "m"}, {APIBase: "http://127.0.0.1:1", Model: "m", MaxRequests: 33}, {APIBase: "http://127.0.0.1:1", Model: "m", MaxTokens: 4097}, {APIBase: "http://127.0.0.1:1", Model: ""}} {
		if _, err := New(cfg); err == nil {
			t.Fatal("invalid provider configuration accepted")
		}
	}
}

func TestModelPlannerDecodesNextToolAsData(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, `{"type":"message","role":"assistant","model":"fixture","stop_reason":"end_turn","content":[{"type":"text","text":"{\"call\":{\"action\":\"file.read\",\"path\":\"output.md\"}}"}],"usage":{"input_tokens":1,"output_tokens":1}}`)
	}))
	defer srv.Close()
	c, err := New(Config{APIBase: srv.URL, Model: "fixture"})
	if err != nil {
		t.Fatal(err)
	}
	d, err := c.Next(context.Background(), boundedrun.PlanningContext{})
	if err != nil || d.Call == nil || d.Call.Action != boundedrun.Read || d.Call.Path != "output.md" {
		t.Fatal(d, err)
	}
}
