package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/nodecommand"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/sui"
)

// Diagnose the exact original prepared Run without a signer or any broadcast.
// Rejected/expired current authority is reported separately from historical reads.
func TestDirectPreparedLiveRead(t *testing.T) {
	path := os.Getenv("FM_DIRECT_PREPARED_READ")
	if path == "" {
		t.Skip("isolated original Run only")
	}
	var input struct{ RPC, PackageID, OkrPackageID, DirectPackageID, RunID, CapabilityID, Fingerprint string }
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if json.Unmarshal(b, &input) != nil || input.RPC != "http://127.0.0.1:29000" {
		t.Fatal("isolated input required")
	}
	rpc, err := sui.NewGRPCClient(input.RPC, "")
	if err != nil {
		t.Fatal(err)
	}
	defer rpc.Close()
	reader, err := nodecommand.NewChainAuthorityResolver(rpc, input.PackageID, input.OkrPackageID, input.DirectPackageID)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	run, found, err := reader.LookupExecution(ctx, input.CapabilityID, input.Fingerprint)
	if err != nil || !found || run.ID != input.RunID || run.Direct == nil {
		t.Fatal("original direct source read failed", err)
	}
	// Query the current capability independently of historical Run validity.
	state, resolveErr := reader.Resolve(ctx, nodecommand.CapabilityRef{ID: input.CapabilityID})
	result := map[string]any{"runId": input.RunID, "capabilityId": input.CapabilityID, "readOnly": true, "broadcasts": 0, "currentAuthorityValid": resolveErr == nil, "directDispatchVerified": false}
	if resolveErr != nil {
		result["authorityError"] = resolveErr.Error()
	} else {
		result["direct"] = state.Direct
	}
	result["state"], result["spent"], result["reserved"], result["settled"] = run.State, run.BudgetSpent, run.BudgetReserved, run.BudgetSettled
	result["originalDirect"] = run.Direct
	b, err = json.Marshal(result)
	if err != nil {
		t.Fatal(err)
	}
	fmt.Printf("FM_DIRECT_PREPARED_READ_RESULT %s\n", b)
}
