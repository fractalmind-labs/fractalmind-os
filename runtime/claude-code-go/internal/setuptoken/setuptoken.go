package setuptoken

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

type Options struct {
	Token        string
	WriteEnvFile string
}

type Result struct {
	Status         string
	TokenSource    string
	TokenMasked    string
	ExportVar      string
	ExportCommand  string
	WriteEnvFile   string
	WriteResult    string
	ScopeHint      string
	Implementation string
	NextStep       string
	Message        string
}

const envVarName = "CLAUDE_CODE_OAUTH_TOKEN"

func BuildResult(opts Options) (Result, error) {
	token, source := resolveToken(opts.Token)
	result := Result{
		ExportVar:      envVarName,
		ScopeHint:      "inference-only",
		Implementation: "minimal-compatible",
	}

	if token == "" {
		result.Status = "needs_token"
		result.Message = "This minimal implementation does not perform the browser OAuth flow yet."
		result.NextStep = "provide --token <token> or export CLAUDE_CODE_OAUTH_TOKEN=<token>"
		return result, nil
	}

	result.Status = "ready"
	result.TokenSource = source
	result.TokenMasked = maskSecret(token)
	result.ExportCommand = fmt.Sprintf("export %s=%s", envVarName, token)
	result.NextStep = "export token in your shell, then rerun auth/config/api commands"

	if strings.TrimSpace(opts.WriteEnvFile) != "" {
		path, err := writeEnvFile(opts.WriteEnvFile, token)
		if err != nil {
			return Result{}, err
		}
		result.WriteEnvFile = path
		result.WriteResult = "success"
	}

	return result, nil
}

func (r Result) String() string {
	lines := []string{
		fmt.Sprintf("status=%s", valueOrNone(r.Status)),
		fmt.Sprintf("implementation=%s", valueOrNone(r.Implementation)),
		fmt.Sprintf("export_var=%s", valueOrNone(r.ExportVar)),
		fmt.Sprintf("scope_hint=%s", valueOrNone(r.ScopeHint)),
	}
	if r.Message != "" {
		lines = append(lines, fmt.Sprintf("message=%s", r.Message))
	}
	if r.TokenSource != "" {
		lines = append(lines, fmt.Sprintf("token_source=%s", r.TokenSource))
	}
	if r.TokenMasked != "" {
		lines = append(lines, fmt.Sprintf("token_masked=%s", r.TokenMasked))
	}
	if r.ExportCommand != "" {
		lines = append(lines, fmt.Sprintf("export_command=%s", r.ExportCommand))
	}
	if r.WriteEnvFile != "" {
		lines = append(lines, fmt.Sprintf("write_env_file=%s", r.WriteEnvFile))
		lines = append(lines, fmt.Sprintf("write_result=%s", valueOrNone(r.WriteResult)))
	}
	if r.NextStep != "" {
		lines = append(lines, fmt.Sprintf("next_step=%s", r.NextStep))
	}
	return strings.Join(lines, "\n") + "\n"
}

func resolveToken(arg string) (string, string) {
	if token := strings.TrimSpace(arg); token != "" {
		return token, "arg"
	}
	if token := strings.TrimSpace(os.Getenv(envVarName)); token != "" {
		return token, "env"
	}
	return "", ""
}

func writeEnvFile(rawPath string, token string) (string, error) {
	path := strings.TrimSpace(rawPath)
	if path == "" {
		return "", fmt.Errorf("empty env file path")
	}
	if strings.HasPrefix(path, "~/") {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", err
		}
		path = filepath.Join(home, path[2:])
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return "", err
	}
	content := fmt.Sprintf("export %s=%s\n", envVarName, token)
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		return "", err
	}
	return path, nil
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

func valueOrNone(v string) string {
	if strings.TrimSpace(v) == "" {
		return "none"
	}
	return v
}
