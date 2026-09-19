package demoagent

import (
	"bytes"
	"testing"
)

func demoIntent() IntentSpec {
	return IntentSpec{
		ActionKind:  "shell_exec",
		TargetScope: "host:worker-1",
		Command:     "echo demo-safe",
		TargetHost:  "worker-1",
	}
}

func TestCanonicalizeIntentDeterministic(t *testing.T) {
	intent := demoIntent()

	first, err := CanonicalizeIntent(intent)
	if err != nil {
		t.Fatalf("CanonicalizeIntent first: %v", err)
	}
	second, err := CanonicalizeIntent(intent)
	if err != nil {
		t.Fatalf("CanonicalizeIntent second: %v", err)
	}

	if !bytes.Equal(first, second) {
		t.Fatalf("canonical intent bytes differ:\n%s\n%s", first, second)
	}
}

func TestHashIntentSensitiveToMaterialFields(t *testing.T) {
	base := demoIntent()
	changed := demoIntent()
	changed.Command = "echo something-else"

	baseHash, err := HashIntent(base)
	if err != nil {
		t.Fatalf("HashIntent base: %v", err)
	}
	changedHash, err := HashIntent(changed)
	if err != nil {
		t.Fatalf("HashIntent changed: %v", err)
	}

	if bytes.Equal(baseHash, changedHash) {
		t.Fatal("intent hash should change when command changes")
	}
	if len(baseHash) != 32 {
		t.Fatalf("intent hash length = %d, want 32", len(baseHash))
	}
}

func TestHashResultDeterministicAnd32Bytes(t *testing.T) {
	result := SimulateResult(demoIntent())

	first, err := HashResult(result)
	if err != nil {
		t.Fatalf("HashResult first: %v", err)
	}
	second, err := HashResult(result)
	if err != nil {
		t.Fatalf("HashResult second: %v", err)
	}

	if len(first) != 32 {
		t.Fatalf("result hash length = %d, want 32", len(first))
	}
	if !bytes.Equal(first, second) {
		t.Fatal("result hash should be deterministic")
	}
}

func TestHashResultSensitiveToMaterialFields(t *testing.T) {
	base := SimulateResult(demoIntent())
	changed := base
	changed.OutputPreview = "different preview"

	baseHash, err := HashResult(base)
	if err != nil {
		t.Fatalf("HashResult base: %v", err)
	}
	changedHash, err := HashResult(changed)
	if err != nil {
		t.Fatalf("HashResult changed: %v", err)
	}

	if bytes.Equal(baseHash, changedHash) {
		t.Fatal("result hash should change when output preview changes")
	}
}

func TestBuildEvidenceMapsPolicyAndScope(t *testing.T) {
	runner := NewRunner("0xpolicy123", 5000)
	intent := demoIntent()

	evidence, result, err := runner.BuildEvidence(intent)
	if err != nil {
		t.Fatalf("BuildEvidence: %v", err)
	}

	if evidence.PolicyID != "0xpolicy123" {
		t.Fatalf("policy ID = %s", evidence.PolicyID)
	}
	if evidence.ActionKind != intent.ActionKind {
		t.Fatalf("action kind = %s, want %s", evidence.ActionKind, intent.ActionKind)
	}
	if evidence.TargetScope != intent.TargetScope {
		t.Fatalf("target scope = %s, want %s", evidence.TargetScope, intent.TargetScope)
	}
	if evidence.GasBudget != 5000 {
		t.Fatalf("gas budget = %d, want 5000", evidence.GasBudget)
	}
	if len(evidence.IntentHash) != 32 || len(evidence.ResultHash) != 32 {
		t.Fatalf("unexpected hash lengths: intent=%d result=%d", len(evidence.IntentHash), len(evidence.ResultHash))
	}
	if result.Status != "simulated_success" || result.ExitCode != 0 {
		t.Fatalf("unexpected result summary: %+v", result)
	}
}

func TestBuildEvidenceRejectsMissingFields(t *testing.T) {
	runner := NewRunner("0xpolicy123", 5000)
	intent := demoIntent()
	intent.Command = ""

	if _, _, err := runner.BuildEvidence(intent); err == nil {
		t.Fatal("expected validation error for missing command")
	}
}
