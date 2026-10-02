package sui

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"testing"
	"time"

	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/nodecommand"
)

// Invoked by the App controller integration fixture through stdin, never argv
// or a credential file. This is a real localnet read/simulation, not CLI/OS
// storage acceptance, and deliberately does not sign/broadcast a Sui transaction.
func TestHostJoinLiveQuote(t *testing.T) {
	if os.Getenv("FM_HOST_JOIN_LIVE_QUOTE") != "1" {
		t.Skip("explicit localnet integration fixture only")
	}
	data, err := io.ReadAll(io.LimitReader(os.Stdin, 8193))
	if err != nil || len(data) > 8192 {
		t.Fatal("invalid bounded fixture input")
	}
	defer clear(data)
	var input struct {
		Code                                                                         string
		Network, PackageID, RegistryID, OrganizationID, HostAddress, ChainIdentifier string
		HostPublicKey, EncryptionPublicKey                                           []byte
	}
	if json.Unmarshal(data, &input) != nil || input.Network != "localnet" {
		t.Fatal("invalid localnet fixture input")
	}
	invitation, err := nodecommand.ParseHostInvitation([]byte(input.Code), input.Network)
	input.Code = ""
	if err != nil {
		t.Fatal(err)
	}
	defer invitation.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	client, err := NewGRPCClient("http://127.0.0.1:29000", "")
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	resolver, err := nodecommand.NewChainAuthorityResolver(client, input.PackageID)
	if err != nil {
		t.Fatal(err)
	}
	request := nodecommand.HostJoinInput{Network: input.Network, ProtocolRegistry: input.RegistryID, InviteID: invitation.ID, ExpectedOrganization: input.OrganizationID, HostAddress: input.HostAddress, ProofPublicKey: invitation.PublicKey(), HostPublicKey: input.HostPublicKey, EncryptionPublicKey: input.EncryptionPublicKey}
	plan, err := resolver.InspectHostJoin(ctx, request)
	if err != nil {
		t.Fatal(err)
	}
	proof, err := invitation.SignJoin(plan, input.HostPublicKey, input.EncryptionPublicKey)
	if err != nil {
		t.Fatal(err)
	}
	quote, err := client.PrepareHostJoin(ctx, HostJoinRequest{PackageID: input.PackageID, ChainIdentifier: input.ChainIdentifier, Sender: input.HostAddress, OrganizationID: plan.OrganizationID, InviteID: plan.InviteID, BindingID: plan.BindingID, IssuerHuman: plan.IssuerHuman, IssuerGrant: plan.IssuerGrant, HostPublicKey: input.HostPublicKey, EncryptionPublicKey: input.EncryptionPublicKey, ProofSignature: proof, Name: "envd quote fixture", ProofExpiresAtMS: plan.ProofExpiresAtMS, GasBudget: 200000000})
	if err != nil {
		t.Fatal(err)
	}
	fresh, err := resolver.InspectHostJoin(ctx, request)
	if err != nil || fresh.VersionPin != plan.VersionPin {
		t.Fatal("join sources changed after quote")
	}
	public, err := json.Marshal(struct {
		Plan      nodecommand.HostJoinPlan `json:"plan"`
		Quote     HostJoinQuote            `json:"quote"`
		Broadcast bool                     `json:"broadcast"`
	}{plan, quote, false})
	if err != nil {
		t.Fatal(err)
	}
	fmt.Printf("FM_HOST_JOIN_QUOTE %s\n", public)
}
