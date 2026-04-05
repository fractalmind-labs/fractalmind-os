package client

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/fractalmind-ai/claude-code-go/internal/config"
)

type Provider interface {
	Name() string
	APIBase() string
}

type AnthropicClient struct {
	apiBase    string
	apiKey     string
	model      string
	maxTokens  int
	httpClient *http.Client
}

type MessagesDemoRequest struct {
	Model     string        `json:"model"`
	MaxTokens int           `json:"max_tokens"`
	Messages  []MessagePart `json:"messages"`
}

type MessagePart struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type DebugRequest struct {
	Method  string
	URL     string
	Headers map[string]string
	Body    string
}

type DebugResponse struct {
	StatusCode int
	Status     string
	Headers    map[string]string
	Body       string
}

func New(cfg config.Config) AnthropicClient {
	return AnthropicClient{
		apiBase:   strings.TrimRight(cfg.APIBase, "/"),
		apiKey:    cfg.APIKey,
		model:     cfg.Model,
		maxTokens: cfg.MaxTokens,
		httpClient: &http.Client{
			Timeout: 20 * time.Second,
		},
	}
}

func (c AnthropicClient) Name() string    { return "anthropic-compatible" }
func (c AnthropicClient) APIBase() string { return c.apiBase }

func (c AnthropicClient) BuildMessagesDemoRequest() (DebugRequest, error) {
	payload := MessagesDemoRequest{
		Model:     c.model,
		MaxTokens: c.maxTokens,
		Messages: []MessagePart{{
			Role:    "user",
			Content: "ping from claude-code-go",
		}},
	}
	body, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		return DebugRequest{}, err
	}
	return DebugRequest{
		Method:  http.MethodPost,
		URL:     c.apiBase + "/v1/messages",
		Headers: c.requestHeaders(true),
		Body:    string(body),
	}, nil
}

func (c AnthropicClient) SendMessagesDemo(ctx context.Context) (DebugResponse, error) {
	payload, err := c.BuildMessagesDemoRequest()
	if err != nil {
		return DebugResponse{}, err
	}
	req, err := http.NewRequestWithContext(ctx, payload.Method, payload.URL, bytes.NewBufferString(payload.Body))
	if err != nil {
		return DebugResponse{}, err
	}
	for key, value := range c.requestHeaders(false) {
		req.Header.Set(key, value)
	}
	res, err := c.httpClient.Do(req)
	if err != nil {
		return DebugResponse{}, err
	}
	defer res.Body.Close()
	data, err := io.ReadAll(io.LimitReader(res.Body, 4096))
	if err != nil {
		return DebugResponse{}, err
	}
	return DebugResponse{
		StatusCode: res.StatusCode,
		Status:     res.Status,
		Headers: map[string]string{
			"content-type": res.Header.Get("content-type"),
			"request-id":   res.Header.Get("request-id"),
		},
		Body: string(data),
	}, nil
}

func (c AnthropicClient) requestHeaders(maskSecretValue bool) map[string]string {
	headers := map[string]string{
		"anthropic-version": "2023-06-01",
		"content-type":      "application/json",
	}
	if c.apiKey != "" {
		headers["x-api-key"] = c.apiKey
	}
	if maskSecretValue && headers["x-api-key"] != "" {
		headers["x-api-key"] = maskSecret(headers["x-api-key"])
	}
	return headers
}

func (r DebugRequest) DebugString() string {
	return fmt.Sprintf("method=%s\nurl=%s\nheaders=%s\nbody=%s\n", r.Method, r.URL, formatHeaders(r.Headers), r.Body)
}

func (r DebugResponse) DebugString() string {
	return fmt.Sprintf("status_code=%d\nstatus=%s\nheaders=%s\nbody=%s\n", r.StatusCode, r.Status, formatHeaders(r.Headers), r.Body)
}

func formatHeaders(headers map[string]string) string {
	if len(headers) == 0 {
		return "{}"
	}
	keys := make([]string, 0, len(headers))
	for k := range headers {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	parts := make([]string, 0, len(headers))
	for _, k := range keys {
		parts = append(parts, fmt.Sprintf("%s=%s", k, headers[k]))
	}
	return "{" + strings.Join(parts, ", ") + "}"
}

func maskSecret(secret string) string {
	if secret == "" {
		return ""
	}
	if len(secret) <= 8 {
		return "***"
	}
	return secret[:4] + "..." + secret[len(secret)-4:]
}
