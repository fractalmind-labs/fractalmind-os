package main

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/hostidentity"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/hostjoin"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/nodecommand"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/sui"
)

type cliFixtureStore struct{ data []byte }

func (s *cliFixtureStore) Get(string) ([]byte, error) {
	if s.data == nil {
		return nil, hostidentity.ErrNotFound
	}
	return append([]byte(nil), s.data...), nil
}
func (s *cliFixtureStore) Create(_ string, data []byte) error {
	if s.data != nil {
		return hostidentity.ErrAlreadyExists
	}
	s.data = append([]byte(nil), data...)
	return nil
}

type cliDropReceipt struct {
	*sui.GRPCClient
	broadcasts int
}

func (c *cliDropReceipt) ExecuteHostJoin(ctx context.Context, q sui.HostJoinQuote, sig string) (sui.HostJoinReceipt, error) {
	c.broadcasts++
	_, err := c.GRPCClient.ExecuteHostJoin(ctx, q, sig)
	if err != nil {
		return sui.HostJoinReceipt{}, err
	}
	return sui.HostJoinReceipt{}, errors.New("injected loss after actual broadcast")
}

// Generated memory keys are injected only into this test binary. Interaction,
// runner, signing, gRPC and the disk journal are the production paths. This does
// not claim OS credential store, hidden TTY or physical/cloud Host acceptance.
func TestHostJoinLiveCLI(t *testing.T) {
	if os.Getenv("FM_HOST_JOIN_LIVE_CLI") != "1" {
		t.Skip("explicit real localnet fixture only")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	frame, err := bufio.NewReaderSize(os.Stdin, 4096).ReadBytes('\n')
	if err != nil || len(frame) > 4096 {
		t.Fatal("invalid public fixture configuration")
	}
	var input struct{ PackageID, RegistryID, OrganizationID, ChainIdentifier, JournalRoot string }
	if json.Unmarshal(frame, &input) != nil || input.JournalRoot == "" {
		t.Fatal("invalid public fixture configuration")
	}
	store := &cliFixtureStore{}
	defer func() { clear(store.data) }()
	keys, err := hostidentity.Initialize(ctx, store, "test-cli", t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer keys.Close()
	public, err := keys.Public("test-cli")
	if err != nil {
		t.Fatal(err)
	}
	hello, _ := json.Marshal(public)
	fmt.Printf("FM_ENVD_HOST_PUBLIC %s\n", hello)
	base, err := sui.NewGRPCClient("http://127.0.0.1:29000", "")
	if err != nil {
		t.Fatal(err)
	}
	defer base.Close()
	client := &cliDropReceipt{GRPCClient: base}
	options := hostjoin.Options{Network: "localnet", Chain: input.ChainIdentifier, PackageID: input.PackageID, TypesPackageID: input.PackageID, RegistryID: input.RegistryID, ExpectedOrganization: input.OrganizationID, Profile: "test-cli", Name: "envd CLI fixture", GasBudget: 200000000, JournalRoot: input.JournalRoot}
	factory := func(original string) (hostjoin.Authority, error) {
		return nodecommand.NewChainAuthorityResolver(base, original)
	}
	result, runErr := hostjoin.Run(ctx, client, factory, keys, options, hostJoinInteraction(os.Stdin, os.Stdout, os.Stderr))
	if result.Digest == "" {
		t.Fatalf("CLI did not prepare/broadcast: %v", runErr)
	}
	initial := result
	// Recreate the runner around the same disk journal. No new invitation is
	// permitted on original-query recovery, including after a lost receipt.
	for n := 0; n < 40; n++ {
		result, runErr = hostjoin.Run(ctx, client, factory, keys, options, hostjoin.Interaction{ReadInvitation: func() ([]byte, error) { t.Fatal("restart asked for bearer code"); return nil, errors.New("forbidden") }})
		if runErr == nil && result.State == "confirmed" && result.Membership != nil {
			break
		}
		time.Sleep(125 * time.Millisecond)
	}
	if runErr != nil || result.State != "confirmed" || result.Membership == nil || !result.Membership.Current || client.broadcasts != 1 {
		t.Fatalf("original recovery failed: %+v %v broadcasts=%d", result, runErr, client.broadcasts)
	}
	options.StatusOnly = true
	options.PublicAddress = public.Address
	withoutKeys, err := hostjoin.Run(ctx, client, nil, nil, options, hostjoin.Interaction{})
	if err != nil || withoutKeys.Digest != result.Digest || withoutKeys.ActualFee != result.ActualFee {
		t.Fatal("public original lookup accessed credentials or lost fee")
	}
	encoded, _ := json.Marshal(struct {
		Initial                hostjoin.Result `json:"initial"`
		Result                 hostjoin.Result `json:"result"`
		Broadcasts             int             `json:"broadcasts"`
		PublicQueryWithoutKeys bool            `json:"public_query_without_keys"`
		RealDiskJournal        bool            `json:"real_disk_journal"`
	}{initial, result, client.broadcasts, true, true})
	fmt.Printf("FM_HOST_JOIN_CLI_RESULT %s\n", encoded)
}
