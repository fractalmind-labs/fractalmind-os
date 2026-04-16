package automode

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

type Rules struct {
	Allow       []string `json:"allow"`
	SoftDeny    []string `json:"soft_deny"`
	Environment []string `json:"environment"`
}

type settingsFile struct {
	AutoMode autoModeSettings `json:"autoMode"`
}

type autoModeSettings struct {
	Allow       []string `json:"allow"`
	SoftDeny    []string `json:"soft_deny"`
	Deny        []string `json:"deny"`
	Environment []string `json:"environment"`
}

var defaultRules = Rules{
	Allow: []string{
		"Read and inspect files inside the current workspace.",
		"Run non-destructive diagnostics such as ls, cat, rg, git status, and test commands.",
		"Edit project files to complete the user's requested task.",
	},
	SoftDeny: []string{
		"Delete or overwrite large amounts of user data without explicit confirmation.",
		"Send messages, trigger external side effects, or share private data without explicit confirmation.",
		"Make production-impacting changes, payments, or credential / permission changes without explicit confirmation.",
	},
	Environment: []string{
		"The agent is running inside a developer CLI workspace.",
		"Section-level autoMode settings replace the defaults for that section.",
		"Project settings are intentionally ignored for auto mode security.",
	},
}

func Defaults() Rules {
	return clone(defaultRules)
}

func EffectiveConfig() (Rules, error) {
	merged, err := loadMergedRules()
	if err != nil {
		return Rules{}, err
	}
	defaults := Defaults()
	if len(merged.Allow) == 0 {
		merged.Allow = defaults.Allow
	}
	if len(merged.SoftDeny) == 0 {
		merged.SoftDeny = defaults.SoftDeny
	}
	if len(merged.Environment) == 0 {
		merged.Environment = defaults.Environment
	}
	return merged, nil
}

func JSON(r Rules) (string, error) {
	data, err := json.MarshalIndent(r, "", "  ")
	if err != nil {
		return "", err
	}
	return string(data) + "\n", nil
}

func loadMergedRules() (Rules, error) {
	paths, err := resolveTrustedSettingsPaths()
	if err != nil {
		return Rules{}, err
	}

	var merged Rules
	for _, path := range paths {
		settings, err := loadSettings(path)
		if err != nil {
			return Rules{}, err
		}
		merged.Allow = append(merged.Allow, settings.Allow...)
		merged.SoftDeny = append(merged.SoftDeny, settings.SoftDeny...)
		merged.SoftDeny = append(merged.SoftDeny, settings.Deny...)
		merged.Environment = append(merged.Environment, settings.Environment...)
	}
	return merged, nil
}

func resolveTrustedSettingsPaths() ([]string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return nil, err
	}
	cwd, err := os.Getwd()
	if err != nil {
		return nil, err
	}

	paths := []string{
		filepath.Join(home, ".claude", "settings.json"),
		filepath.Join(cwd, ".claude", "settings.local.json"),
	}
	if flagPath := os.Getenv("CLAUDE_CODE_GO_FLAG_SETTINGS_PATH"); flagPath != "" {
		paths = append(paths, flagPath)
	}
	if policyPath := os.Getenv("CLAUDE_CODE_GO_POLICY_SETTINGS_PATH"); policyPath != "" {
		paths = append(paths, policyPath)
	}
	return paths, nil
}

func loadSettings(path string) (autoModeSettings, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return autoModeSettings{}, nil
		}
		return autoModeSettings{}, err
	}

	var file settingsFile
	if err := json.Unmarshal(data, &file); err != nil {
		return autoModeSettings{}, fmt.Errorf("parse %s: %w", path, err)
	}
	return file.AutoMode, nil
}

func clone(r Rules) Rules {
	return Rules{
		Allow:       append([]string(nil), r.Allow...),
		SoftDeny:    append([]string(nil), r.SoftDeny...),
		Environment: append([]string(nil), r.Environment...),
	}
}
