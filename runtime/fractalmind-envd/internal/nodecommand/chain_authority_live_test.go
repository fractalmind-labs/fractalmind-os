package nodecommand_test

import (
	"context"
	"encoding/json"
	"os"
	"testing"
	"time"

	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/nodecommand"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/sui"
)

// Called by the SDK localnet acceptance script before and after real state
// mutations. The input contains only public object IDs and the expected result.
func TestChainAuthorityLive(t *testing.T) {
	raw := os.Getenv("FM_CHAIN_AUTHORITY_CASE")
	if raw == "" {
		t.Skip("requires isolated localnet acceptance input")
	}
	var input struct{ RPC, PackageID, CapabilityID, ExpectedCode string }
	if err := json.Unmarshal([]byte(raw), &input); err != nil {
		t.Fatal(err)
	}
	client, err := sui.NewGRPCClient(input.RPC, "")
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	resolver, err := nodecommand.NewChainAuthorityResolver(client, input.PackageID)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	state, err := resolver.Resolve(ctx, nodecommand.CapabilityRef{ID: input.CapabilityID})
	if input.ExpectedCode != "" {
		if string(nodecommand.CodeOf(err)) != input.ExpectedCode {
			t.Fatalf("expected %s, got %v", input.ExpectedCode, err)
		}
		return
	}
	if err != nil {
		t.Fatal(err)
	}
	if state.ID != input.CapabilityID || state.AuthorityVersionHash == "" || state.CheckpointObservedAtMS == 0 || len(state.AuthorizedSigners) != 1 {
		t.Fatalf("incomplete chain projection: %+v", state)
	}
	t.Logf("real gRPC chain projection: org=%s host=%s instance=%s versions=%s", state.Target.OrganizationID, state.Target.NodeID, state.Target.AgentID, state.AuthorityVersionHash)
}
