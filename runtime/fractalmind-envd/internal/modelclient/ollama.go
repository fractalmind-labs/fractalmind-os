package modelclient

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"unicode/utf8"
)

// This constrains syntax, not the next action or its path/content. The model
// still chooses read, write or stop; all values pass the existing Host checks.
const ollamaDecisionSchema = `{"oneOf":[
{"type":"object","additionalProperties":false,"required":["call"],"properties":{"call":{"type":"object","additionalProperties":false,"required":["action","path"],"properties":{"action":{"const":"file.read"},"path":{"type":"string","minLength":1,"maxLength":1024}}}}},
{"type":"object","additionalProperties":false,"required":["call"],"properties":{"call":{"type":"object","additionalProperties":false,"required":["action","path","content","expected_hash"],"properties":{"action":{"const":"file.write"},"path":{"type":"string","minLength":1,"maxLength":1024},"content":{"type":"string"},"expected_hash":{"type":"string","pattern":"^([0-9a-f]{64})?$"}}}}},
{"type":"object","additionalProperties":false,"required":["stop"],"properties":{"stop":{"type":"string","minLength":1,"maxLength":1024}}}
]}`

// Ollama receives the same bounded input as the Messages provider. JSON mode
// constrains the response encoding; the existing Host executor remains the
// authority for every action, goal, observation and tool-budget decision.
func (c *Client) sendOllama(ctx context.Context, system, message string, jsonMode bool) (Reply, error) {
	payload := struct {
		Model    string          `json:"model"`
		Stream   bool            `json:"stream"`
		Format   json.RawMessage `json:"format,omitempty"`
		Messages []struct {
			Role    string `json:"role"`
			Content string `json:"content"`
		} `json:"messages"`
		Options struct {
			NumPredict  int `json:"num_predict"`
			Temperature int `json:"temperature"`
		} `json:"options"`
	}{Model: c.cfg.Model}
	payload.Options.NumPredict = c.cfg.MaxTokens
	if jsonMode {
		payload.Format = json.RawMessage(ollamaDecisionSchema)
	}
	for _, item := range []struct{ role, content string }{{"system", system}, {"user", message}} {
		payload.Messages = append(payload.Messages, struct {
			Role    string `json:"role"`
			Content string `json:"content"`
		}{item.role, item.content})
	}
	data, err := json.Marshal(payload)
	if err != nil {
		return Reply{}, fmt.Errorf("model request encoding failed")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(c.cfg.APIBase, "/")+"/api/chat", bytes.NewReader(data))
	if err != nil {
		return Reply{}, fmt.Errorf("model request is invalid")
	}
	req.Header.Set("content-type", "application/json")
	if c.apiKey != "" {
		req.Header.Set("authorization", "Bearer "+c.apiKey)
	}
	res, err := c.http.Do(req)
	if err != nil {
		return Reply{}, fmt.Errorf("model transport failed")
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return Reply{}, fmt.Errorf("model returned HTTP %d", res.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(res.Body, (1<<20)+1))
	if err != nil || len(body) > 1<<20 {
		return Reply{}, fmt.Errorf("model response exceeds limit or is incomplete")
	}
	var response struct {
		Model   string `json:"model"`
		Message struct {
			Role      string            `json:"role"`
			Content   string            `json:"content"`
			ToolCalls []json.RawMessage `json:"tool_calls"`
			Images    []json.RawMessage `json:"images"`
		} `json:"message"`
		Done         *bool  `json:"done"`
		DoneReason   string `json:"done_reason"`
		InputTokens  *int64 `json:"prompt_eval_count"`
		OutputTokens *int64 `json:"eval_count"`
	}
	if !utf8.Valid(body) || json.Unmarshal(body, &response) != nil || response.Model == "" || len(response.Model) > 160 || response.Message.Role != "assistant" || response.Done == nil || !*response.Done || response.DoneReason != "stop" || response.InputTokens == nil || response.OutputTokens == nil || *response.InputTokens < 0 || *response.OutputTokens < 0 || len(response.Message.ToolCalls) != 0 || len(response.Message.Images) != 0 {
		return Reply{}, fmt.Errorf("model response is not a complete text answer")
	}
	if len(response.Message.Content) == 0 || len(response.Message.Content) > 128<<10 {
		return Reply{}, fmt.Errorf("model text answer is empty or too large")
	}
	// Ollama's native API has no request ID. Do not invent a provider receipt.
	return Reply{Text: response.Message.Content, Model: response.Model, Usage: Usage{*response.InputTokens, *response.OutputTokens}}, nil
}
