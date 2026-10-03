package main

import (
	"bufio"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/agent"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/boundedrun"

	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/config"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/coordinator"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/heartbeat"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/hostidentity"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/hostjoin"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/nodecommand"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/runtimeadapter"
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
	// The explicit App scenario includes additional native fee confirmations;
	// this fixture lifetime does not extend any capability or message deadline.
	liveTimeout := 300 * time.Second
	if os.Getenv("FM_ENVD_DIRECT_APP") == "1" {
		liveTimeout = 900 * time.Second
	}
	ctx, cancel := context.WithTimeout(context.Background(), liveTimeout)
	defer cancel()
	frame, err := bufio.NewReaderSize(os.Stdin, 4096).ReadBytes('\n')
	if err != nil || len(frame) > 4096 {
		t.Fatal("invalid public fixture configuration")
	}
	var input struct {
		PackageID, OkrPackageID, DirectPackageID, RegistryID, OrganizationID, ChainIdentifier, JournalRoot string
		LiveConnection                                                                                     bool
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
	var connected chan error
	var nativeRuntime *chainRuntimeExecutor
	var nativeConfig *config.Config
	var nativeWorkspace string
	var deviceCommandDispatches atomic.Int64
	if input.LiveConnection {
		reader, err = nodecommand.NewChainAuthorityResolver(base, input.PackageID, input.OkrPackageID, input.DirectPackageID)
		if err != nil {
			t.Fatal(err)
		}
		liveConfig = &config.Config{SUI: config.SUIConfig{Network: "localnet", ProtocolRegistryID: input.RegistryID, ProtocolPackageID: input.PackageID, OkrPackageID: input.OkrPackageID, DirectPackageID: input.DirectPackageID, ChainIdentifier: input.ChainIdentifier, OrgID: input.OrganizationID}, Coordinator: config.CoordinatorConfig{BindingID: result.Membership.BindingID}}
		commandTimeout := time.Second
		if os.Getenv("FM_ENVD_DEVICE_COMMAND") == "1" || os.Getenv("FM_ENVD_HANDOVER_APPROVAL") == "1" {
			commandTimeout = 30 * time.Second
		}
		liveServer = coordinator.NewServer("", commandTimeout, "")
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
		connected = make(chan error, 1)
		var discovery *agent.Discovery
		var rescan func() agent.Discovery
		var nativeAdapter *runtimeadapter.Executor
		if os.Getenv("FM_ENVD_NATIVE_DISCOVERY") == "1" {
			workspace := t.TempDir()
			if os.Getenv("FM_ENVD_NATIVE_APP_EXECUTION") == "1" {
				// The App reviews an existing docs directory as its narrow scope.
				// Creating this isolated fixture root does not grant tool rights.
				if err := os.Mkdir(filepath.Join(workspace, "docs"), 0700); err != nil {
					t.Fatal(err)
				}
			}
			nativeWorkspace = workspace
			adapter, e := runtimeadapter.BoundedFileAgent(reader, map[string]string{"native-files": workspace}, runtimeadapter.ObservationAgentManager("must-not-run"))
			if e != nil {
				t.Fatal(e)
			}
			nativeAdapter = runtimeadapter.NewExecutor(nil, adapter)
			if os.Getenv("FM_ENVD_NATIVE_EXECUTION") == "1" || os.Getenv("FM_ENVD_HANDOVER_APPROVAL") == "1" {
				nativeConfig = chainRuntimeConfig()
				nativeConfig.SUI.Network = "localnet"
				nativeConfig.SUI.ProtocolPackageID = input.PackageID
				nativeConfig.SUI.OkrPackageID = input.OkrPackageID
				nativeConfig.SUI.DirectPackageID = input.DirectPackageID
				nativeConfig.SUI.ProtocolRegistryID = input.RegistryID
				nativeConfig.SUI.ChainIdentifier = input.ChainIdentifier
				nativeConfig.SUI.OrgID = input.OrganizationID
				nativeConfig.Runtime.AdapterKind = "native-file-agent"
				nativeConfig.Runtime.Workspaces = map[string]string{"native-files": workspace}
				nativeConfig.Runtime.ChainQueue = os.Getenv("FM_ENVD_CHAIN_QUEUE") == "1"
				if endpoint := os.Getenv("FM_ENVD_TEST_MODEL_API_BASE"); endpoint != "" {
					nativeConfig.Runtime.Model = config.ModelConfig{Enabled: true, APIBase: endpoint, Name: "synthetic-protocol-fixture", MaxTokens: 2048, MaxRequests: 12, TimeoutSeconds: 30}
				}
				created, e := newRuntimeCommandExecutorWithStore(nativeConfig, store)
				if e != nil {
					t.Fatal(e)
				}
				nativeRuntime = created.(*chainRuntimeExecutor)
				t.Cleanup(func() { nativeRuntime.Close() })
				nativeAdapter = nativeRuntime.Executor
			}
		}
		if os.Getenv("FM_ENVD_AGENT_DISCOVERY") == "1" {
			fixtureDir, e := os.MkdirTemp("/tmp", "fm-chain-discovery-")
			if e != nil {
				t.Fatal(e)
			}
			defer os.RemoveAll(fixtureDir)
			socket := filepath.Join(fixtureDir, "tmux.sock")
			cmd := exec.Command("tmux", "-S", socket, "-f", "/dev/null", "new-session", "-d", "-s", "agent-chain-existing", "-c", fixtureDir, "sleep 300")
			if e = cmd.Run(); e != nil {
				t.Fatal("isolated real tmux fixture unavailable", e)
			}
			defer exec.Command("tmux", "-S", socket, "kill-server").Run()
			scanner := agent.NewScannerAtSocket("tmux", socket)
			rescan = scanner.Discover
			value := rescan()
			if value.State != "complete" || len(value.Instances) != 1 || value.Instances[0].State != "observed" {
				t.Fatalf("real tmux discovery unavailable: %+v", value)
			}
			discovery = &value
		}
		sendHeartbeat := func() error {
			payload := heartbeat.NewPayload(public.Address, "physical loopback fixture", nil, time.Now())
			payload.Discovery = discovery
			if nativeAdapter != nil {
				payload.NativeDiscovery = nativeAdapter.NativeDiscovery()
			}
			if rescan != nil {
				fresh := rescan()
				if fresh.State != "complete" || len(fresh.Instances) != 1 || fresh.Instances[0].State != "observed" || fresh.Instances[0].InstanceID != discovery.Instances[0].InstanceID {
					return errors.New("tmux process continuity lost across connection")
				} else {
					payload.Discovery = &fresh
				}
			}
			if payload.Discovery != nil {
				for _, instance := range payload.Discovery.Instances {
					payload.Agents = append(payload.Agents, agent.Agent{ID: instance.Session, Session: instance.Session, Status: "running"})
				}
			}
			return liveClient.Send("heartbeat", payload)
		}
		liveClient.OnConnect(func() {
			err := liveClient.Send("register", map[string]string{"host_id": public.Address, "hostname": "physical loopback fixture"})
			if err == nil {
				err = sendHeartbeat()
			}
			select {
			case connected <- err:
			default:
			}
		})
		if os.Getenv("FM_ENVD_DEVICE_COMMAND") == "1" || os.Getenv("FM_ENVD_HANDOVER_APPROVAL") == "1" {
			if nativeRuntime == nil {
				t.Fatal("device commands require the production native executor")
			}
			liveClient.OnCommand(func(command ws.CommandPayload) {
				deviceCommandDispatches.Add(1)
				response := handleCommand(command, nil, nativeConfig, nativeRuntime)
				if err := liveClient.Send("command_result", map[string]any{"request_id": command.RequestID, "result": response}); err != nil {
					t.Errorf("device command result send failed: %v", err)
				}
			})
		}
		go liveClient.Connect()
		select {
		case err = <-connected:
			if err != nil {
				t.Fatal(err)
			}
		case <-ctx.Done():
			t.Fatal("live chain connection did not authenticate")
		}
		if os.Getenv("FM_ENVD_WORKLOAD_RECOVERY") == "1" {
			// Recovery intentionally outlives a single observation's 60s TTL.
			// Use fresh physical scans and the production signed Send path rather
			// than weakening expiry or manufacturing an online cached Host.
			beatCtx, beatCancel := context.WithCancel(ctx)
			beatDone := make(chan struct{})
			go func() {
				defer close(beatDone)
				ticker := time.NewTicker(10 * time.Second)
				defer ticker.Stop()
				for {
					select {
					case <-beatCtx.Done():
						return
					case <-ticker.C:
						// Revocation or transport loss must make an observation
						// unavailable. Never cache a successful replacement.
						if e := sendHeartbeat(); e != nil {
							t.Logf("isolated recovery heartbeat unavailable: %v", e)
						}
					}
				}
			}()
			t.Cleanup(func() { beatCancel(); <-beatDone })
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
	if os.Getenv("FM_ENVD_NATIVE_EXECUTION") == "1" {
		if nativeRuntime == nil {
			t.Fatal("native production executor required")
		}
		for _, phase := range []string{"status", "execute"} {
			line, e := bufio.NewReaderSize(os.Stdin, 32).ReadString('\n')
			if e != nil || line != strings.ToUpper(phase)+"\n" {
				t.Fatal("expected native control public phase", phase)
			}
			fmt.Printf("FM_NATIVE_CONTROL_READY {\"phase\":\"%s\"}\n", phase)
			raw, e := bufio.NewReaderSize(os.Stdin, 65536).ReadBytes('\n')
			if e != nil || len(raw) > 65536 {
				t.Fatal("invalid generated native commands")
			}
			var commands struct {
				Command nodecommand.NodeCommand
				After   nodecommand.NodeCommand
			}
			if json.Unmarshal(raw, &commands) != nil {
				t.Fatal("invalid native command frame")
			}
			scan := nativeRuntime.NativeDiscovery()
			if scan == nil || scan.State != "complete" || len(scan.Instances) != 1 || commands.Command.Target.AgentID != scan.Instances[0].InstanceID {
				t.Fatal("command bypassed discovered alias")
			}
			response, _, e := nativeRuntime.Execute(ctx, commands.Command)
			if e != nil || !response.OK || response.ExecutionState != "succeeded" {
				t.Fatalf("native alias command failed: %+v %v", response, e)
			}
			report := map[string]any{"phase": phase, "response": response, "production_factory": true, "discovered_alias": scan.Instances[0].InstanceID}
			report["device_command_dispatches"] = deviceCommandDispatches.Load()
			if phase == "status" {
				var state runtimeadapter.NativeState
				if json.Unmarshal(response.Result, &state) != nil || state.PhysicalState != "idle" || state.InstanceID != scan.Instances[0].InstanceID {
					t.Fatal("native physical idle unavailable")
				}
			} else {
				if response.Spend == nil || !response.Spend.Known || response.Spend.Amount != 6 {
					t.Fatal("native alias did not use six real tools")
				}
				var taskPayload struct{ Task string }
				if json.Unmarshal(commands.Command.Payload, &taskPayload) != nil {
					t.Fatal("invalid file task")
				}
				task, e := boundedrun.ParseFileTask(taskPayload.Task)
				if e != nil {
					t.Fatal(e)
				}
				for _, goal := range task.Files {
					value, e := os.ReadFile(filepath.Join(nativeWorkspace, goal.Path))
					if e != nil || string(value) != goal.Content {
						t.Fatal("native alias did not attain actual file goal")
					}
				}
				again, e := newRuntimeCommandExecutorWithStore(nativeConfig, store)
				if e != nil {
					t.Fatal(e)
				}
				rebuilt := again.(*chainRuntimeExecutor)
				duplicate, _, e := rebuilt.Execute(ctx, commands.Command)
				if e != nil || !duplicate.Duplicate || string(duplicate.Result) != string(response.Result) || duplicate.TransactionDigest != response.TransactionDigest {
					t.Fatal("native duplicate did not reconstruct original chain evidence", e)
				}
				rebuilt.Close()
				after, _, e := nativeRuntime.Execute(ctx, commands.After)
				if e != nil || !after.OK {
					t.Fatal("post-execution native status unavailable", e)
				}
				var state runtimeadapter.NativeState
				if json.Unmarshal(after.Result, &state) != nil || state.PhysicalState != "idle" || state.ActiveCommandID != "" {
					t.Fatal("physical slot not released after tools closed")
				}
				report["after"] = after
				report["actual_workspace_writes"] = true
				report["factory_rebuild_duplicate"] = true
				report["duplicate_digest"] = duplicate.TransactionDigest
			}
			encoded, _ := json.Marshal(report)
			fmt.Printf("FM_NATIVE_CONTROL_RESULT %s\n", encoded)
		}
	}
	if input.LiveConnection {
		if os.Getenv("FM_ENVD_RECOVERY_AUTHORITY") == "1" {
			if nativeRuntime == nil || os.Getenv("FM_ENVD_WORKLOAD_RECOVERY") != "1" {
				t.Fatal("recovery authority requires the actual workload executor")
			}
			// Public, explicit test-binary protocol. It does not add a product
			// endpoint or bypass the production Executor's current authority checks.
			frames := bufio.NewReaderSize(os.Stdin, 65536)
			for round := 1; round <= 2; round++ {
				var original nodecommand.NodeCommand
				var originalRun nodecommand.ChainExecution
				for _, stage := range []string{"before", "after"} {
					label := fmt.Sprintf("RECOVERY_AUTHORITY_%d_%s", round, strings.ToUpper(stage))
					line, e := frames.ReadString('\n')
					if e != nil || line != label+"\n" {
						t.Fatal("expected explicit recovery authority phase", label)
					}
					fmt.Printf("FM_%s_READY {}\n", label)
					raw, e := frames.ReadBytes('\n')
					if e != nil || len(raw) > 65536 {
						t.Fatal("invalid public recovery command frame")
					}
					var frame struct {
						ExecutionID string
						Command     nodecommand.NodeCommand
					}
					if json.Unmarshal(raw, &frame) != nil {
						t.Fatal("invalid public recovery command")
					}
					command := frame.Command
					signing, e := command.SigningBytes()
					if e != nil || (nodecommand.Ed25519Verifier{}).Verify(ctx, command.Signer, signing, command.Signature) != nil || command.Action != "status" || command.Scope != "observation" || command.Budget != nil || command.ExpiresAtMS <= time.Now().UnixMilli() || command.ExpiresAtMS-command.IssuedAtMS > 300000 {
						t.Fatal("recovery probe requires an actual valid unexpired status signature")
					}
					hash := sha256.Sum256(signing)
					fingerprint := hex.EncodeToString(hash[:])
					run, found, e := reader.LookupExecution(ctx, command.Capability.ID, fingerprint)
					reservation := nodecommand.Reservation{CapabilityID: command.Capability.ID, Signer: command.Signer, CommandID: command.CommandID, Nonce: command.Nonce, IdempotencyKey: command.IdempotencyKey, Fingerprint: fingerprint, Budget: command.Budget, Target: command.Target, Action: command.Action, CommandScope: command.Scope, IssuedAtMS: command.IssuedAtMS, ExpiresAtMS: command.ExpiresAtMS}
					if e != nil || !found || run.ID != frame.ExecutionID || run.State != 0 || run.StopRequested || run.ResultRecordID != "" || !run.Matches(reservation) || run.HostAddress != public.Address {
						t.Fatal("recovery probe must use its exact original queued Run", e)
					}
					var report map[string]any
					if stage == "before" {
						state, e := reader.Resolve(ctx, command.Capability)
						scan := nativeRuntime.NativeDiscovery()
						if e != nil || state.Revoked || len(state.AuthorizedSigners) != 1 || state.AuthorizedSigners[0] != command.Signer || state.ManagedInstance == nil || state.ManagedInstance.ID != run.ManagedAgentID || scan == nil || scan.State != "complete" || len(scan.Instances) != 1 || scan.Instances[0].InstanceID != command.Target.AgentID {
							t.Fatal("old device was not currently authorized at actual Host", e)
						}
						original, originalRun = command, run
						report = map[string]any{"round": round, "stage": stage, "executionId": run.ID, "signatureVerified": true, "currentAuthorityResolved": true, "queuedUnexecuted": true, "expiresAtMs": command.ExpiresAtMS}
					} else {
						if !reflect.DeepEqual(command, original) || !reflect.DeepEqual(run, originalRun) {
							t.Fatal("recovery probe replaced or mutated the original command/Run")
						}
						response, event, e := nativeRuntime.Execute(ctx, command)
						if nodecommand.CodeOf(e) != nodecommand.CodeRevoked || !strings.Contains(e.Error(), "device permission or identity generation changed") || response.OK || event.ResultCode != string(nodecommand.CodeRevoked) || time.Now().UnixMilli() >= command.ExpiresAtMS {
							t.Fatalf("actual Host did not independently reject old generation: response=%+v event=%+v err=%v", response, event, e)
						}
						after, found, e := reader.LookupExecution(ctx, command.Capability.ID, fingerprint)
						if e != nil || !found || !reflect.DeepEqual(after, originalRun) {
							t.Fatal("rejected old command changed its original Run", e)
						}
						report = map[string]any{"round": round, "stage": stage, "executionId": run.ID, "rejectionCode": string(nodecommand.CodeRevoked), "rejectionReason": "device permission or identity generation changed", "productionExecutor": true, "bypassedCoordinator": true, "originalRunUnchanged": true, "checkedAtMs": time.Now().UnixMilli(), "expiresAtMs": command.ExpiresAtMS}
					}
					encoded, _ := json.Marshal(report)
					fmt.Printf("FM_%s_RESULT %s\n", label, encoded)
				}
			}
		}
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
		if os.Getenv("FM_ENVD_HOST_REJOIN") != "1" {
			liveClient.Close()
		}
		fmt.Printf("FM_CHAIN_CONNECTION_RESULT {\"chain_endpoint_used\":true,\"mutual_authentication\":true,\"heartbeat_sent\":true,\"revoked_pointer_rejected\":true,\"worker_revoked_heartbeat_rejected\":true,\"coordinator_revoked_routing_rejected\":true,\"generated_memory_keys\":true,\"loopback_only\":true}\n")
		if os.Getenv("FM_ENVD_HOST_REJOIN") == "1" {
			line, err = bufio.NewReaderSize(os.Stdin, 32).ReadString('\n')
			if err != nil || line != "REJOIN\n" {
				t.Fatal("expected explicit public rejoin signal")
			}
			fmt.Printf("FM_HOST_REJOIN_READY {}\n")
			previous := result
			options.StatusOnly, options.NewAttempt = false, true
			result, runErr = hostjoin.Run(ctx, client, factory, keys, options, hostJoinInteraction(os.Stdin, os.Stdout, os.Stderr))
			if result.Digest == "" || result.Digest == previous.Digest {
				t.Fatal("new confirmed admission requires a distinct original digest")
			}
			options.NewAttempt = false
			for n := 0; n < 40; n++ {
				result, runErr = hostjoin.Run(ctx, client, factory, keys, options, hostjoin.Interaction{ReadInvitation: func() ([]byte, error) {
					t.Fatal("rejoin recovery asked for another code")
					return nil, errors.New("forbidden")
				}})
				if runErr == nil && result.State == "confirmed" && result.Membership != nil {
					break
				}
				time.Sleep(125 * time.Millisecond)
			}
			if runErr != nil || result.State != "confirmed" || result.Membership == nil || !result.Membership.Current || result.Membership.MembershipID == previous.Membership.MembershipID || result.Membership.HostAddress != public.Address || client.broadcasts != 2 {
				t.Fatalf("explicit rejoin failed: %+v %v", result, runErr)
			}
			current, e := reader.ReadHostConnection(ctx, input.OrganizationID, mustDecodeHex(t, public.SigningPublicKey), mustDecodeHex(t, public.EncryptionPublicKey))
			if e != nil || current.MembershipID != result.Membership.MembershipID {
				t.Fatal("new current membership not used", e)
			}
			select {
			case e := <-connected:
				if e != nil {
					t.Fatal("new connection did not publish a fresh continuous scan", e)
				}
			case <-ctx.Done():
				t.Fatal("same worker did not reauthenticate after explicit rejoin")
			}
			encoded, _ := json.Marshal(struct {
				Result         hostjoin.Result `json:"result"`
				Broadcasts     int             `json:"broadcasts"`
				SameKeys       bool            `json:"same_host_keys"`
				SameWorker     bool            `json:"same_worker_reauthenticated"`
				ArchivedDigest string          `json:"archived_original_digest"`
			}{result, client.broadcasts, true, true, previous.Digest})
			fmt.Printf("FM_HOST_REJOIN_RESULT %s\n", encoded)
		}
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
