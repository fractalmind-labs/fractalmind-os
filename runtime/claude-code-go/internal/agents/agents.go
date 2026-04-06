package agents

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

type Definition struct {
	Description string `json:"description"`
	Prompt      string `json:"prompt,omitempty"`
	Model       string `json:"model,omitempty"`
	Source      string `json:"-"`
}

type filePayload struct {
	Agents map[string]Definition `json:"agents"`
}

type ListResult struct {
	Sources     []string
	Checked     []string
	Definitions map[string]Definition
}

func List(settingSources string) (ListResult, error) {
	sources, err := normalizeSources(settingSources)
	if err != nil {
		return ListResult{}, err
	}

	checked := make([]string, 0, len(sources))
	definitions := map[string]Definition{}
	for _, source := range sources {
		path, err := resolvePath(source)
		if err != nil {
			return ListResult{}, err
		}
		checked = append(checked, fmt.Sprintf("%s=%s", source, path))
		payload, err := loadFile(path)
		if err != nil {
			return ListResult{}, err
		}
		for name, def := range payload.Agents {
			def.Source = source
			definitions[name] = def
		}
	}

	return ListResult{
		Sources:     sources,
		Checked:     checked,
		Definitions: definitions,
	}, nil
}

func (r ListResult) String() string {
	var b strings.Builder
	b.WriteString(fmt.Sprintf("setting_sources=%s\n", strings.Join(r.Sources, ",")))
	b.WriteString(fmt.Sprintf("checked=%s\n", strings.Join(r.Checked, "; ")))
	b.WriteString(fmt.Sprintf("agent_count=%d\n", len(r.Definitions)))
	if len(r.Definitions) == 0 {
		b.WriteString("agents=none\n")
		return b.String()
	}

	names := make([]string, 0, len(r.Definitions))
	for name := range r.Definitions {
		names = append(names, name)
	}
	sort.Strings(names)

	for _, name := range names {
		def := r.Definitions[name]
		b.WriteString(fmt.Sprintf("- name=%s source=%s description=%s\n", name, valueOrNone(def.Source), valueOrNone(def.Description)))
		if def.Model != "" {
			b.WriteString(fmt.Sprintf("  model=%s\n", def.Model))
		}
		if def.Prompt != "" {
			b.WriteString(fmt.Sprintf("  prompt_present=%t\n", true))
		}
	}

	return b.String()
}

func normalizeSources(raw string) ([]string, error) {
	if strings.TrimSpace(raw) == "" {
		return []string{"user", "project", "local"}, nil
	}

	items := strings.Split(raw, ",")
	sources := make([]string, 0, len(items))
	seen := map[string]bool{}
	for _, item := range items {
		source := strings.TrimSpace(item)
		if source == "" {
			continue
		}
		switch source {
		case "user", "project", "local":
		default:
			return nil, fmt.Errorf("unknown setting source: %s", source)
		}
		if !seen[source] {
			sources = append(sources, source)
			seen[source] = true
		}
	}

	if len(sources) == 0 {
		return nil, fmt.Errorf("no valid setting sources provided")
	}

	return sources, nil
}

func resolvePath(source string) (string, error) {
	switch source {
	case "user":
		dir, err := os.UserConfigDir()
		if err != nil {
			return "", err
		}
		return filepath.Join(dir, "claude-code-go", "agents.json"), nil
	case "project":
		cwd, err := os.Getwd()
		if err != nil {
			return "", err
		}
		return filepath.Join(cwd, ".claude-code-go", "agents.json"), nil
	case "local":
		cwd, err := os.Getwd()
		if err != nil {
			return "", err
		}
		return filepath.Join(cwd, ".claude-code-go", "agents.local.json"), nil
	default:
		return "", fmt.Errorf("unknown setting source: %s", source)
	}
}

func loadFile(path string) (filePayload, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return filePayload{}, nil
		}
		return filePayload{}, err
	}

	var payload filePayload
	if err := json.Unmarshal(data, &payload); err != nil {
		return filePayload{}, fmt.Errorf("parse %s: %w", path, err)
	}
	if payload.Agents == nil {
		payload.Agents = map[string]Definition{}
	}
	return payload, nil
}

func valueOrNone(v string) string {
	if strings.TrimSpace(v) == "" {
		return "none"
	}
	return v
}
