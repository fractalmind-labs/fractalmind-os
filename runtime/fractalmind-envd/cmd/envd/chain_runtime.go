package main

import (
	"crypto/ed25519"
	"encoding/hex"
	"fmt"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/config"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/hostidentity"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/modelclient"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/nodecommand"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/runtimeadapter"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/sui"
)

type chainRuntimeRPC interface {
	sui.ResultStoreRPC
	nodecommand.ChainObjectReader
	Close() error
}
type chainRuntimeExecutor struct {
	*runtimeadapter.Executor
	keys     *hostidentity.Keys
	signer   *sui.Keypair
	rpc      chainRuntimeRPC
	once     sync.Once
	closeErr error
}

func (e *chainRuntimeExecutor) Close() error {
	e.once.Do(func() { e.closeErr = e.rpc.Close(); clear(e.signer.Private); e.keys.Close() })
	return e.closeErr
}
func (e *chainRuntimeExecutor) controlKeypair() (*sui.Keypair, error) {
	private, err := e.keys.SigningPrivate()
	if err != nil {
		return nil, err
	}
	return &sui.Keypair{Private: private, Public: private.Public().(ed25519.PublicKey)}, nil
}
func canonicalObjectID(value string) (string, error) {
	if !strings.HasPrefix(value, "0x") || len(value) < 3 || len(value) > 66 {
		return "", fmt.Errorf("Sui object ID is required")
	}
	value = strings.TrimPrefix(value, "0x")
	value = strings.Repeat("0", 64-len(value)) + value
	if _, err := hex.DecodeString(value); err != nil {
		return "", fmt.Errorf("invalid Sui object ID")
	}
	return "0x" + strings.ToLower(value), nil
}
func newChainRuntimeExecutor(cfg *config.Config, keys *hostidentity.Keys, rpc chainRuntimeRPC, adapter runtimeadapter.Adapter) (*chainRuntimeExecutor, error) {
	if cfg == nil || keys == nil || rpc == nil || adapter == nil {
		return nil, fmt.Errorf("configuration, secure Host identity, chain RPC and adapter are required")
	}
	org, err := canonicalObjectID(strings.TrimSpace(cfg.SUI.OrgID))
	if err != nil {
		return nil, err
	}
	current, err := canonicalObjectID(strings.TrimSpace(cfg.SUI.ProtocolPackageID))
	if err != nil {
		return nil, err
	}
	original := strings.TrimSpace(cfg.SUI.ProtocolOriginalPackageID)
	if original == "" {
		original = current
	}
	original, err = canonicalObjectID(original)
	if err != nil {
		return nil, err
	}
	if cfg.SUI.DirectOriginalPackageID != "" && cfg.SUI.DirectPackageID == "" {
		return nil, fmt.Errorf("direct type origin requires its call package")
	}
	if cfg.SUI.OkrOriginalPackageID != "" && cfg.SUI.OkrPackageID == "" {
		return nil, fmt.Errorf("OKR type origin requires its call package")
	}
	private, err := keys.SigningPrivate()
	if err != nil {
		return nil, err
	}
	signer := &sui.Keypair{Private: private, Public: private.Public().(ed25519.PublicKey)}
	if target := strings.TrimSpace(cfg.Identity.HostID); target != "" && target != signer.Address() {
		clear(private)
		return nil, fmt.Errorf("identity.host_id must match the secure Host signing address")
	}
	resolver, err := nodecommand.NewChainAuthorityResolver(rpc, original, okrTypeOrigin(cfg), directTypeOrigin(cfg))
	if err != nil {
		clear(private)
		return nil, err
	}
	reservations, err := sui.NewChainReservations(resolver, rpc, signer, current, cfg.SUI.OkrPackageID, cfg.SUI.DirectPackageID)
	if err != nil {
		clear(private)
		return nil, err
	}
	authority, err := nodecommand.NewChainAuthorityStore(resolver, reservations)
	if err != nil {
		clear(private)
		return nil, err
	}
	validator := nodecommand.NewValidator(nodecommand.Ed25519Verifier{}, authority, nodecommand.ValidatorOptions{
		LocalTarget:    nodecommand.Target{OrganizationID: org, NodeID: signer.Address()},
		LowRiskActions: signedCommandLowRiskActions(), HighRiskActions: signedCommandHighRiskActions(),
		BudgetedActions: signedCommandHighRiskActions(), MaxCommandTTL: 5 * time.Minute,
		MaxLowRiskCheckpointAge: 24 * time.Hour, MaxHighRiskCheckpointAge: 2 * time.Minute,
	})
	results, err := sui.NewChainExecutionStore(resolver, rpc, signer, current, keys.EncryptionSecret, sui.ChainExecutionStoreOptions{ResultGasBudget: cfg.Runtime.ResultGasBudget, OkrPackageID: cfg.SUI.OkrPackageID, DirectPackageID: cfg.SUI.DirectPackageID})
	if err != nil {
		clear(private)
		return nil, err
	}
	executor, err := runtimeadapter.NewExecutorWithCommandStore(validator, adapter, results)
	if err != nil {
		clear(private)
		return nil, err
	}
	return &chainRuntimeExecutor{Executor: executor, keys: keys, signer: signer, rpc: rpc}, nil
}

func runtimeConfigurationEnabled(cfg *config.Config) (bool, error) {
	if cfg == nil {
		return false, fmt.Errorf("config is required")
	}
	if !cfg.Runtime.Enabled {
		if strings.TrimSpace(os.Getenv("FRACTALMIND_RUNTIME_STATE_DIR")) != "" {
			return false, fmt.Errorf("file-authorized runtime is retired; configure runtime.enabled with Sui and initialize the Host identity")
		}
		return false, nil
	}
	if strings.TrimSpace(os.Getenv("FRACTALMIND_NODE_COMMAND_AUTHORITY_FILE")) != "" {
		return false, fmt.Errorf("production authority files are not accepted; Sui is authoritative")
	}
	if !cfg.SUI.Enabled || strings.TrimSpace(cfg.SUI.RPC) == "" || strings.TrimSpace(cfg.SUI.OrgID) == "" || strings.TrimSpace(cfg.SUI.ProtocolPackageID) == "" {
		return false, fmt.Errorf("runtime requires sui.enabled, rpc, org_id and protocol_package_id")
	}
	return true, nil
}
func newRuntimeCommandExecutorFromEnv(cfg *config.Config) (runtimeCommandExecutor, error) {
	enabled, err := runtimeConfigurationEnabled(cfg)
	if err != nil || !enabled {
		return nil, err
	}
	store, err := hostidentity.OpenNativeStore()
	if err != nil {
		return nil, err
	}
	return newRuntimeCommandExecutorWithStore(cfg, store)
}
func newRuntimeCommandExecutorWithStore(cfg *config.Config, store hostidentity.Store) (runtimeCommandExecutor, error) {
	enabled, err := runtimeConfigurationEnabled(cfg)
	if err != nil || !enabled {
		return nil, err
	}
	keys, err := hostidentity.Load(store, cfg.Identity.KeyProfile)
	if err != nil {
		return nil, fmt.Errorf("load secure Host identity; initialize with envd --init-host: %w", err)
	}
	rpc, err := sui.NewGRPCClient(cfg.SUI.RPC, cfg.SUI.GraphQLURL)
	if err != nil {
		keys.Close()
		return nil, err
	}
	command := strings.TrimSpace(cfg.Runtime.AdapterCommand)
	args := cfg.Runtime.AdapterArgs
	if command == "" {
		command = strings.TrimSpace(os.Getenv("FRACTALMIND_AGENT_MANAGER_COMMAND"))
		args = splitRuntimeAdapterArgs(os.Getenv("FRACTALMIND_AGENT_MANAGER_ARGS"))
	}
	if command == "" {
		command = "agent-manager"
	}
	// Existing tmux/agent-manager instances have no execution sandbox. Observing
	// them must not grant control merely because the chain record says bounded.
	var adapter runtimeadapter.Adapter = runtimeadapter.ObservationAgentManager(command, args...)
	if cfg.Runtime.Model.Enabled && cfg.Runtime.AdapterKind != "native-file-agent" {
		rpc.Close()
		keys.Close()
		return nil, fmt.Errorf("runtime.model requires the native-file-agent adapter")
	}
	switch cfg.Runtime.AdapterKind {
	case "", "observation":
	case "native-file-agent":
		original := cfg.SUI.ProtocolOriginalPackageID
		if original == "" {
			original = cfg.SUI.ProtocolPackageID
		}
		resolver, resolverErr := nodecommand.NewChainAuthorityResolver(rpc, original, okrTypeOrigin(cfg), directTypeOrigin(cfg))
		if resolverErr != nil {
			rpc.Close()
			keys.Close()
			return nil, resolverErr
		}
		var model *modelclient.Client
		if cfg.Runtime.Model.Enabled {
			m := cfg.Runtime.Model
			model, err = modelclient.New(modelclient.Config{APIBase: m.APIBase, APIKeyEnv: m.APIKeyEnv, Model: m.Name, MaxTokens: m.MaxTokens, TimeoutSeconds: m.TimeoutSeconds, MaxRequests: m.MaxRequests})
			if err != nil {
				rpc.Close()
				keys.Close()
				return nil, err
			}
		}
		adapter, err = runtimeadapter.BoundedFileAgentWithModel(resolver, cfg.Runtime.Workspaces, adapter, model)
		if err != nil {
			rpc.Close()
			keys.Close()
			return nil, err
		}
	default:
		rpc.Close()
		keys.Close()
		return nil, fmt.Errorf("unsupported runtime.adapter_kind %q", cfg.Runtime.AdapterKind)
	}
	executor, err := newChainRuntimeExecutor(cfg, keys, rpc, adapter)
	if err != nil {
		rpc.Close()
		keys.Close()
		return nil, err
	}
	return executor, nil
}

func okrTypeOrigin(cfg *config.Config) string {
	if cfg.SUI.OkrOriginalPackageID != "" {
		return cfg.SUI.OkrOriginalPackageID
	}
	return cfg.SUI.OkrPackageID
}

// Direct state retains core Run types and its independent original extension ID.
func directTypeOrigin(cfg *config.Config) string {
	if cfg.SUI.DirectOriginalPackageID != "" {
		return cfg.SUI.DirectOriginalPackageID
	}
	if cfg.SUI.DirectPackageID != "" {
		return cfg.SUI.DirectPackageID
	}
	if cfg.SUI.ProtocolOriginalPackageID != "" {
		return cfg.SUI.ProtocolOriginalPackageID
	}
	return cfg.SUI.ProtocolPackageID
}
