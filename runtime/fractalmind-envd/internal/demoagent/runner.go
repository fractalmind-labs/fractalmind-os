// Package demoagent builds deterministic policy-demo evidence for the
// hackathon MVP without executing real commands or touching production systems.
package demoagent

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/fractalmind-ai/fractalmind-envd/internal/sui"
)

const schemaVersion = "envd-policy-demo/v1"

// SchemaVersion returns the canonical evidence schema version.
func SchemaVersion() string { return schemaVersion }

// IntentSpec is the minimal fixed-intent shape for the policy demo.
type IntentSpec struct {
	ActionKind  string
	TargetScope string
	Command     string
	TargetHost  string
}

// ResultSummary is the deterministic command-result summary hashed on-chain.
type ResultSummary struct {
	Status          string
	ExitCode        int
	OutputPreview   string
	ExecutedCommand string
	TargetHost      string
}

// Runner converts a fixed demo intent into canonical action evidence.
type Runner struct {
	policyID  string
	gasBudget uint64
}

// NewRunner creates a deterministic demo runner for one policy and gas budget.
func NewRunner(policyID string, gasBudget uint64) *Runner {
	return &Runner{
		policyID:  strings.TrimSpace(policyID),
		gasBudget: gasBudget,
	}
}

// BuildEvidence converts one fixed intent into a result summary and
// policy-compatible action evidence.
func (r *Runner) BuildEvidence(intent IntentSpec) (sui.ActionEvidence, ResultSummary, error) {
	intent = normalizeIntent(intent)
	if err := validateIntent(intent); err != nil {
		return sui.ActionEvidence{}, ResultSummary{}, err
	}
	if r.policyID == "" {
		return sui.ActionEvidence{}, ResultSummary{}, fmt.Errorf("policy ID is required")
	}
	if r.gasBudget == 0 {
		return sui.ActionEvidence{}, ResultSummary{}, fmt.Errorf("gas budget must be greater than zero")
	}

	result := SimulateResult(intent)
	intentHash, err := HashIntent(intent)
	if err != nil {
		return sui.ActionEvidence{}, ResultSummary{}, err
	}
	resultHash, err := HashResult(result)
	if err != nil {
		return sui.ActionEvidence{}, ResultSummary{}, err
	}

	evidence := sui.ActionEvidence{
		PolicyID:    r.policyID,
		ActionKind:  intent.ActionKind,
		TargetScope: intent.TargetScope,
		IntentHash:  intentHash,
		ResultHash:  resultHash,
		GasBudget:   r.gasBudget,
	}

	return evidence, result, nil
}

// SimulateResult produces a deterministic, harmless result summary for the demo.
func SimulateResult(intent IntentSpec) ResultSummary {
	intent = normalizeIntent(intent)
	return ResultSummary{
		Status:          "simulated_success",
		ExitCode:        0,
		OutputPreview:   fmt.Sprintf("demo accepted command %q for host %s", intent.Command, intent.TargetHost),
		ExecutedCommand: intent.Command,
		TargetHost:      intent.TargetHost,
	}
}

// CanonicalizeIntent returns stable JSON bytes for an intent.
func CanonicalizeIntent(intent IntentSpec) ([]byte, error) {
	intent = normalizeIntent(intent)
	payload := struct {
		Version     string `json:"version"`
		ActionKind  string `json:"action_kind"`
		TargetScope string `json:"target_scope"`
		Command     string `json:"command"`
		TargetHost  string `json:"target_host"`
	}{
		Version:     schemaVersion,
		ActionKind:  intent.ActionKind,
		TargetScope: intent.TargetScope,
		Command:     intent.Command,
		TargetHost:  intent.TargetHost,
	}
	return json.Marshal(payload)
}

// CanonicalizeResult returns stable JSON bytes for a result summary.
func CanonicalizeResult(result ResultSummary) ([]byte, error) {
	result = normalizeResult(result)
	payload := struct {
		Version         string `json:"version"`
		Status          string `json:"status"`
		ExitCode        int    `json:"exit_code"`
		OutputPreview   string `json:"output_preview"`
		ExecutedCommand string `json:"executed_command"`
		TargetHost      string `json:"target_host"`
	}{
		Version:         schemaVersion,
		Status:          result.Status,
		ExitCode:        result.ExitCode,
		OutputPreview:   result.OutputPreview,
		ExecutedCommand: result.ExecutedCommand,
		TargetHost:      result.TargetHost,
	}
	return json.Marshal(payload)
}

// HashIntent returns a 32-byte canonical SHA-256 hash of the intent.
func HashIntent(intent IntentSpec) ([]byte, error) {
	data, err := CanonicalizeIntent(intent)
	if err != nil {
		return nil, err
	}
	return hashBytes(data), nil
}

// HashResult returns a 32-byte canonical SHA-256 hash of the result summary.
func HashResult(result ResultSummary) ([]byte, error) {
	data, err := CanonicalizeResult(result)
	if err != nil {
		return nil, err
	}
	return hashBytes(data), nil
}

func validateIntent(intent IntentSpec) error {
	switch {
	case intent.ActionKind == "":
		return fmt.Errorf("action kind is required")
	case intent.TargetScope == "":
		return fmt.Errorf("target scope is required")
	case intent.Command == "":
		return fmt.Errorf("command is required")
	case intent.TargetHost == "":
		return fmt.Errorf("target host is required")
	default:
		return nil
	}
}

func normalizeIntent(intent IntentSpec) IntentSpec {
	intent.ActionKind = strings.TrimSpace(intent.ActionKind)
	intent.TargetScope = strings.TrimSpace(intent.TargetScope)
	intent.Command = strings.TrimSpace(intent.Command)
	intent.TargetHost = strings.TrimSpace(intent.TargetHost)
	return intent
}

func normalizeResult(result ResultSummary) ResultSummary {
	result.Status = strings.TrimSpace(result.Status)
	result.OutputPreview = strings.TrimSpace(result.OutputPreview)
	result.ExecutedCommand = strings.TrimSpace(result.ExecutedCommand)
	result.TargetHost = strings.TrimSpace(result.TargetHost)
	return result
}

func hashBytes(data []byte) []byte {
	sum := sha256.Sum256(data)
	return sum[:]
}
