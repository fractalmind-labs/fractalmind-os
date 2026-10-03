package main

import (
	"bufio"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/hostidentity"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/nodecommand"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/sui"
)

func validateNativeRestartFixture(profile, workspace string) error {
	if runtime.GOOS != "darwin" || !regexp.MustCompile(`^test-native-restart-[0-9a-f-]{36}$`).MatchString(profile) {
		return fmt.Errorf("isolated macOS native Host profile required")
	}
	if !strings.HasPrefix(workspace, "/private/tmp/fm-native-host-restart-") || filepath.Clean(workspace) != workspace {
		return fmt.Errorf("isolated canonical native workspace required")
	}
	return nil
}

// A fresh actual process loads the production OS provider and production
// runtime factory. No private key, injected store, local result cache or new
// invitation crosses the process boundary. This is not physical/cloud restart.
func TestHostNativeRestartLive(t *testing.T) {
	if os.Getenv("FM_HOST_NATIVE_RESTART_LIVE") != "1" {
		t.Skip("explicit native Host process restart on isolated localnet only")
	}
	frames := bufio.NewReaderSize(os.Stdin, 65536)
	frame, err := frames.ReadBytes('\n')
	if err != nil || len(frame) > 65536 {
		t.Fatal("bounded public restart input required")
	}
	var input struct {
		Mode, NativeProfile, NativeWorkspace                                                       string
		PackageID, OriginalPackageID, OkrPackageID, DirectPackageID                                string
		OriginalOkrPackageID, OriginalDirectPackageID, RegistryID, OrganizationID, ChainIdentifier string
		MembershipID, ExecutionID, ResultRecordID, ResultDigest, ResultHash, FirstInstanceID       string
		OriginalCommand                                                                            nodecommand.NodeCommand
		ExpectedPublic                                                                             hostidentity.Public
	}
	if json.Unmarshal(frame, &input) != nil {
		t.Fatal("invalid public restart input")
	}
	if err := validateNativeRestartFixture(input.NativeProfile, input.NativeWorkspace); err != nil {
		t.Fatal(err)
	}
	if input.Mode == "remove" {
		if err := removeNativeRestartIdentity(input.NativeProfile); err != nil {
			t.Fatal(err)
		}
		store, err := hostidentity.OpenNativeStore()
		if err != nil {
			t.Fatal(err)
		}
		if _, err := hostidentity.Load(store, input.NativeProfile); err != hostidentity.ErrNotFound {
			t.Fatal("isolated Host key still readable", err)
		}
		fmt.Printf("FM_NATIVE_HOST_CLEANUP {\"removed\":true}\n")
		return
	}
	if input.Mode != "query" || input.ChainIdentifier == "" {
		t.Fatal("explicit original-query mode required")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()
	cfg := chainRuntimeConfig()
	cfg.Identity.KeyProfile = input.NativeProfile
	cfg.Identity.HostID = input.ExpectedPublic.Address
	cfg.SUI.Network, cfg.SUI.ChainIdentifier = "localnet", input.ChainIdentifier
	cfg.SUI.ProtocolPackageID, cfg.SUI.ProtocolOriginalPackageID = input.PackageID, input.OriginalPackageID
	cfg.SUI.OkrPackageID, cfg.SUI.OkrOriginalPackageID = input.OkrPackageID, input.OriginalOkrPackageID
	cfg.SUI.DirectPackageID, cfg.SUI.DirectOriginalPackageID = input.DirectPackageID, input.OriginalDirectPackageID
	cfg.SUI.ProtocolRegistryID, cfg.SUI.OrgID = input.RegistryID, input.OrganizationID
	cfg.Runtime.AdapterKind = "native-file-agent"
	cfg.Runtime.Workspaces = map[string]string{"native-files": input.NativeWorkspace}
	created, err := newRuntimeCommandExecutorFromEnv(cfg)
	if err != nil {
		t.Fatal(err)
	}
	executor := created.(*chainRuntimeExecutor)
	defer executor.Close()
	public, err := executor.keys.Public(input.NativeProfile)
	if err != nil || !reflect.DeepEqual(public, input.ExpectedPublic) {
		t.Fatal("OS Host identity changed", err)
	}
	reader, err := connectionResolver(cfg, executor.rpc.(connectionRPC))
	if err != nil {
		t.Fatal(err)
	}
	if err = executor.rpc.(connectionRPC).CheckHostJoinChain(ctx, input.ChainIdentifier); err != nil {
		t.Fatal(err)
	}
	connection, err := reader.ReadHostConnection(ctx, input.OrganizationID, mustDecodeHex(t, public.SigningPublicKey), mustDecodeHex(t, public.EncryptionPublicKey))
	if err != nil || connection.MembershipID != input.MembershipID {
		t.Fatal("original membership not reconstructed", err)
	}
	scan := executor.NativeDiscovery()
	if scan == nil || scan.State != "complete" || len(scan.Instances) != 1 || scan.Instances[0].InstanceID == input.FirstInstanceID || scan.Instances[0].Workspace != input.NativeWorkspace {
		t.Fatal("restart did not expose a fresh physical instance")
	}
	signingBytes, err := input.OriginalCommand.SigningBytes()
	if err != nil {
		t.Fatal(err)
	}
	intent := sha256.Sum256(signingBytes)
	fingerprint := hex.EncodeToString(intent[:])
	before, found, err := reader.LookupExecution(ctx, input.OriginalCommand.Capability.ID, fingerprint)
	if err != nil || !found || before.ID != input.ExecutionID || before.State != 2 || before.ResultRecordID != input.ResultRecordID {
		t.Fatal("original terminal Run missing", err)
	}
	results, err := sui.NewChainExecutionStore(reader, executor.rpc, executor.signer, input.PackageID, executor.keys.EncryptionSecret, sui.ChainExecutionStoreOptions{ResultGasBudget: cfg.Runtime.ResultGasBudget, OkrPackageID: input.OkrPackageID, DirectPackageID: input.DirectPackageID})
	if err != nil {
		t.Fatal(err)
	}
	record, found, err := results.LoadCommand(ctx, input.OriginalCommand)
	if err != nil || !found || !record.Response.OK || record.Response.TransactionDigest != input.ResultDigest {
		t.Fatal("native OS keys cannot decrypt original chain result", err)
	}
	hash := sha256.Sum256(record.Response.Result)
	if hex.EncodeToString(hash[:]) != input.ResultHash {
		t.Fatal("original result body changed")
	}
	response, event, err := executor.Execute(ctx, input.OriginalCommand)
	if nodecommand.CodeOf(err) != nodecommand.CodeRevoked || response.OK || event.ResultCode != string(nodecommand.CodeRevoked) {
		t.Fatal("completed OKR command regained execution authority", err)
	}
	after, found, err := reader.LookupExecution(ctx, input.OriginalCommand.Capability.ID, fingerprint)
	if err != nil || !found || !reflect.DeepEqual(after, before) {
		t.Fatal("original Run changed after restart", err)
	}
	evidence := map[string]any{"pid": os.Getpid(), "host": public, "membershipId": connection.MembershipID, "instanceId": scan.Instances[0].InstanceID, "originalInstanceId": input.FirstInstanceID, "originalRunId": before.ID, "originalResultRecordId": before.ResultRecordID, "resultDigest": record.Response.TransactionDigest, "resultSha256": hex.EncodeToString(hash[:]), "completedCommandRejected": true, "originalRunUnchanged": true, "newInvitationUsed": false, "nativeStore": true, "productionFactory": true}
	encoded, _ := json.Marshal(evidence)
	fmt.Printf("FM_NATIVE_HOST_RESTART_RESULT %s\n", encoded)
	line, err := frames.ReadString('\n')
	if err != nil || line != "REVOKED\n" {
		t.Fatal("expected original Host revocation signal")
	}
	if _, err = reader.ReadHostConnection(ctx, input.OrganizationID, mustDecodeHex(t, public.SigningPublicKey), mustDecodeHex(t, public.EncryptionPublicKey)); err == nil {
		t.Fatal("restarted Host ignored original membership revocation")
	}
	response, event, err = executor.Execute(ctx, input.OriginalCommand)
	if nodecommand.CodeOf(err) != nodecommand.CodeRevoked || response.OK || event.ResultCode != string(nodecommand.CodeRevoked) {
		t.Fatal("restarted Host authorized revoked membership", err)
	}
	fmt.Printf("FM_NATIVE_HOST_REVOKED {\"currentPointerRejected\":true,\"originalCommandRejected\":true}\n")
}
