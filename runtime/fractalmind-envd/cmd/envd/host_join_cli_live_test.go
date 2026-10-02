package main

import (
	"bufio"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/config"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/coordinator"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/heartbeat"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/hostidentity"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/hostjoin"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/nodecommand"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/sui"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/ws"
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
	ctx, cancel := context.WithTimeout(context.Background(), 180*time.Second)
	defer cancel()
	frame, err := bufio.NewReaderSize(os.Stdin, 4096).ReadBytes('\n')
	if err != nil || len(frame) > 4096 {
		t.Fatal("invalid public fixture configuration")
	}
	var input struct {
		PackageID, RegistryID, OrganizationID, ChainIdentifier, JournalRoot string
		LiveConnection                                                      bool
	}
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
	var listener net.Listener
	var coordKey *sui.Keypair
	var endpoint string
	if input.LiveConnection {
		pub, private, err := ed25519.GenerateKey(rand.Reader)
		if err != nil {
			t.Fatal(err)
		}
		defer clear(private)
		coordKey = &sui.Keypair{Private: private, Public: pub}
		listener, err = net.Listen("tcp", "127.0.0.1:0")
		if err != nil {
			t.Fatal(err)
		}
		defer listener.Close()
		endpoint = "http://" + listener.Addr().String()
	}
	coordPublic, coordAddress := "", ""
	if coordKey != nil {
		coordPublic = hex.EncodeToString(coordKey.Public)
		coordAddress = coordKey.Address()
	}
	hello, _ := json.Marshal(struct {
		hostidentity.Public
		CoordinatorPublic  string `json:"coordinator_public_key,omitempty"`
		CoordinatorAddress string `json:"coordinator_address,omitempty"`
		Endpoint           string `json:"coordinator_endpoint,omitempty"`
	}{public, coordPublic, coordAddress, endpoint})
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
	var liveClient *ws.Client
	var liveServer *coordinator.Server
	var reader *nodecommand.ChainAuthorityResolver
	var liveConfig *config.Config
	if input.LiveConnection {
		reader, err = nodecommand.NewChainAuthorityResolver(base, input.PackageID)
		if err != nil {
			t.Fatal(err)
		}
		liveConfig = &config.Config{SUI: config.SUIConfig{Network: "localnet", ProtocolRegistryID: input.RegistryID, ProtocolPackageID: input.PackageID, ChainIdentifier: input.ChainIdentifier, OrgID: input.OrganizationID}, Coordinator: config.CoordinatorConfig{BindingID: result.Membership.BindingID}}
		liveServer = coordinator.NewServer("", time.Second, "")
		if err = configureChainCoordinator(liveServer, liveConfig, base, coordKey); err != nil {
			t.Fatal(err)
		}
		if err = liveServer.StartOnListener(listener); err != nil {
			t.Fatal(err)
		}
		defer liveServer.Shutdown(context.Background())
		private, err := keys.SigningPrivate()
		if err != nil {
			t.Fatal(err)
		}
		defer clear(private)
		hostKey := &sui.Keypair{Private: private, Public: private.Public().(ed25519.PublicKey)}
		enc, _ := hex.DecodeString(public.EncryptionPublicKey)
		liveClient = ws.NewClient("ws://must-not-be-used.invalid", 50*time.Millisecond)
		if err = configureChainWorker(liveClient, liveConfig, base, hostKey, enc); err != nil {
			t.Fatal(err)
		}
		defer liveClient.Close()
		connected := make(chan error, 1)
		liveClient.OnConnect(func() {
			err := liveClient.Send("register", map[string]string{"host_id": public.Address, "hostname": "physical loopback fixture"})
			if err == nil {
				err = liveClient.Send("heartbeat", heartbeat.NewPayload(public.Address, "physical loopback fixture", nil, time.Now()))
			}
			select {
			case connected <- err:
			default:
			}
		})
		go liveClient.Connect()
		select {
		case err = <-connected:
			if err != nil {
				t.Fatal(err)
			}
		case <-ctx.Done():
			t.Fatal("live chain connection did not authenticate")
		}
		// The App fixture now proves its device grant over HTTP and verifies the
		// heartbeat through that protected API after this public readiness marker.
	}
	encoded, _ := json.Marshal(struct {
		Initial                hostjoin.Result `json:"initial"`
		Result                 hostjoin.Result `json:"result"`
		Broadcasts             int             `json:"broadcasts"`
		PublicQueryWithoutKeys bool            `json:"public_query_without_keys"`
		RealDiskJournal        bool            `json:"real_disk_journal"`
	}{initial, result, client.broadcasts, true, true})
	fmt.Printf("FM_HOST_JOIN_CLI_RESULT %s\n", encoded)
	if input.LiveConnection {
		// No new secrets are read: the fixture waits only for the App's public
		// revocation signal, then observes the actual current chain pointer.
		line, err := bufio.NewReaderSize(os.Stdin, 32).ReadString('\n')
		if err != nil || line != "REVOKED\n" {
			t.Fatal("expected public revocation signal")
		}
		if _, err = reader.ReadHostConnection(ctx, input.OrganizationID, mustDecodeHex(t, public.SigningPublicKey), mustDecodeHex(t, public.EncryptionPublicKey)); err == nil {
			t.Fatal("revoked membership still authorizes Host connection")
		}
		_, err = liveServer.SendCommand(public.Address, "signed_command", "", "{}")
		if err == nil || !strings.Contains(err.Error(), nodecommand.ErrChainObjectNotFound.Error()) {
			t.Fatal("revoked route accepted")
		}
		if err = liveClient.Send("heartbeat", heartbeat.Payload{HostID: public.Address}); err == nil {
			t.Fatal("worker sent heartbeat after chain revocation")
		}
		liveClient.Close()
		fmt.Printf("FM_CHAIN_CONNECTION_RESULT {\"chain_endpoint_used\":true,\"mutual_authentication\":true,\"heartbeat_sent\":true,\"revoked_pointer_rejected\":true,\"worker_revoked_heartbeat_rejected\":true,\"coordinator_revoked_routing_rejected\":true,\"generated_memory_keys\":true,\"loopback_only\":true}\n")
		line, err = bufio.NewReaderSize(os.Stdin, 32).ReadString('\n')
		if err != nil || line != "DONE\n" {
			t.Fatal("expected public completion signal")
		}
	}
}

func mustDecodeHex(t *testing.T, value string) []byte {
	t.Helper()
	raw, err := hex.DecodeString(value)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}
