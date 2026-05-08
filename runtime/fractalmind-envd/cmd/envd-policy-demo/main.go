// envd-policy-demo emits deterministic local evidence for the Sui Overflow
// bounded-agent-policy demo. It does not execute commands or submit txs.
package main

import (
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"os"

	"github.com/fractalmind-ai/fractalmind-envd/internal/demoagent"
)

type output struct {
	SchemaVersion string                  `json:"schema_version"`
	Intent        demoagent.IntentSpec    `json:"intent"`
	Result        demoagent.ResultSummary `json:"result"`
	Evidence      evidenceOutput          `json:"evidence"`
}

type evidenceOutput struct {
	PolicyID      string `json:"policy_id"`
	ActionKind    string `json:"action_kind"`
	TargetScope   string `json:"target_scope"`
	IntentHashHex string `json:"intent_hash_hex"`
	ResultHashHex string `json:"result_hash_hex"`
	IntentHashLen int    `json:"intent_hash_len"`
	ResultHashLen int    `json:"result_hash_len"`
	GasBudget     uint64 `json:"gas_budget"`
}

func main() {
	policyID := flag.String("policy-id", "", "AgentPolicy object ID to bind evidence to")
	actionKind := flag.String("action-kind", "shell_exec", "allowed action kind")
	targetScope := flag.String("target-scope", "host:worker-1", "allowed target scope")
	command := flag.String("command", "echo demo-safe", "harmless fixed-intent command")
	targetHost := flag.String("target-host", "worker-1", "target host label")
	gasBudget := flag.Uint64("gas-budget", 5000, "policy execution gas budget")
	flag.Parse()

	runner := demoagent.NewRunner(*policyID, *gasBudget)
	intent := demoagent.IntentSpec{
		ActionKind:  *actionKind,
		TargetScope: *targetScope,
		Command:     *command,
		TargetHost:  *targetHost,
	}

	evidence, result, err := runner.BuildEvidence(intent)
	if err != nil {
		fmt.Fprintf(os.Stderr, "build policy demo evidence: %v\n", err)
		os.Exit(1)
	}

	out := output{
		SchemaVersion: demoagent.SchemaVersion(),
		Intent:        intent,
		Result:        result,
		Evidence: evidenceOutput{
			PolicyID:      evidence.PolicyID,
			ActionKind:    evidence.ActionKind,
			TargetScope:   evidence.TargetScope,
			IntentHashHex: "0x" + hex.EncodeToString(evidence.IntentHash),
			ResultHashHex: "0x" + hex.EncodeToString(evidence.ResultHash),
			IntentHashLen: len(evidence.IntentHash),
			ResultHashLen: len(evidence.ResultHash),
			GasBudget:     evidence.GasBudget,
		},
	}

	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	if err := enc.Encode(out); err != nil {
		fmt.Fprintf(os.Stderr, "encode policy demo evidence: %v\n", err)
		os.Exit(1)
	}
}
