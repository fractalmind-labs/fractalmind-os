package sui

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/nodecommand"
)

// Moves real testnet Gas from a funded throwaway invitation key to a Host
// address. Set INVITE_GAS_LIVE_CODE to an FHI1 testnet invitation whose key
// address holds SUI, INVITE_GAS_LIVE_RECIPIENT to the receiving address and
// INVITE_GAS_LIVE_CHAIN to the testnet chain identifier.
func TestLiveClaimInviteGas(t *testing.T) {
	code, recipient, chain := os.Getenv("INVITE_GAS_LIVE_CODE"), os.Getenv("INVITE_GAS_LIVE_RECIPIENT"), os.Getenv("INVITE_GAS_LIVE_CHAIN")
	if code == "" || recipient == "" || chain == "" {
		t.Skip("set INVITE_GAS_LIVE_CODE, INVITE_GAS_LIVE_RECIPIENT and INVITE_GAS_LIVE_CHAIN for the live claim")
	}
	invite, err := nodecommand.ParseHostInvitation([]byte(code), "testnet")
	if err != nil {
		t.Fatal(err)
	}
	defer invite.Close()
	c, err := NewGRPCClient("https://fullnode.testnet.sui.io:443", "")
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	claim, err := c.ClaimInviteGas(ctx, chain, invite, recipient)
	if err != nil {
		t.Fatalf("claim: %v (%+v)", err, claim)
	}
	t.Logf("invitation %s -> %s: %+v", invite.Address(), recipient, claim)
	if claim.Status != "confirmed" || claim.Amount == "" {
		t.Fatalf("expected a confirmed transfer: %+v", claim)
	}
	again, err := c.ClaimInviteGas(ctx, chain, invite, recipient)
	if err != nil || again.Status != "none" {
		t.Fatalf("a drained invitation must report none: %+v %v", again, err)
	}
}
