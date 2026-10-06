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

// Read-only interop against existing original SDK/native Runs. No wallet,
// Host signer, faucet, dispatch, start, settlement or business-state writes.
func TestDirectAuthorityOriginalRunsLive(t *testing.T) {
	path := os.Getenv("FM_DIRECT_AUTHORITY_READ_INPUT")
	if path == "" {
		t.Skip("isolated original-object read only")
	}
	var input struct {
		RPC, PackageID, OkrPackageID, DirectPackageID, PermissionID string
		Runs                                                        []struct {
			RunID, CapabilityID, Fingerprint string
			Approved                         bool
		}
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if err = json.Unmarshal(data, &input); err != nil {
		t.Fatal(err)
	}
	if input.RPC != "http://127.0.0.1:29000" || len(input.Runs) != 2 {
		t.Fatal("isolated original localnet objects required")
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
	report := map[string]any{"readOnly": true, "broadcasts": 0, "source": "original confirmed native three-package Runs", "directDispatchVerified": false}
	results := []map[string]any{}
	for _, source := range input.Runs {
		run, found, err := reader.LookupExecution(ctx, source.CapabilityID, source.Fingerprint)
		if err != nil || !found {
			t.Fatalf("original Run: %v", err)
		}
		if run.ID != source.RunID || run.State != 5 || !run.BudgetSettled || run.BudgetSpent != 0 || run.BudgetReserved != 0 || run.Direct == nil || run.Contract != nil || run.Direct.PermissionID != input.PermissionID || run.Direct.PermissionVersion != 1 || (run.Direct.ApprovalID != "") != source.Approved {
			t.Fatalf("original historical direct settlement disagrees: %+v", run)
		}
		foreign, err := nodecommand.NewChainAuthorityResolver(rpc, input.PackageID, input.OkrPackageID, input.PackageID)
		if err != nil {
			t.Fatal(err)
		}
		if _, found, err = foreign.LookupExecution(ctx, source.CapabilityID, source.Fingerprint); err == nil || found {
			t.Fatal("core lookalike accepted as configured direct origin")
		}
		results = append(results, map[string]any{"runId": run.ID, "capabilityId": run.CapabilityID, "permissionId": run.Direct.PermissionID, "originalPermissionVersion": run.Direct.PermissionVersion, "messageId": run.Direct.MessageID, "messageRecordId": run.Direct.MessageRecordID, "approvalId": run.Direct.ApprovalID, "state": run.State, "spent": run.BudgetSpent, "reserved": run.BudgetReserved, "settled": run.BudgetSettled, "foreignOriginRejected": true})
	}
	report["runs"] = results
	data, err = json.Marshal(report)
	if err != nil {
		t.Fatal(err)
	}
	fmt.Printf("FM_DIRECT_AUTHORITY_READ_RESULT %s\n", data)
}
