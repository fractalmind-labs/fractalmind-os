package main

import (
	"context"
	"encoding/hex"
	"fmt"
	"sync"

	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/config"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/coordinator"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/nodecommand"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/sui"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/ws"
)

type connectionRPC interface {
	nodecommand.ChainObjectReader
	CheckHostJoinChain(context.Context, string) error
}

func connectionResolver(cfg *config.Config, rpc connectionRPC) (*nodecommand.ChainAuthorityResolver, error) {
	if rpc == nil || cfg.SUI.ChainIdentifier == "" {
		return nil, fmt.Errorf("chain connection requires a pinned chain identifier")
	}
	original := cfg.SUI.ProtocolOriginalPackageID
	if original == "" {
		original = cfg.SUI.ProtocolPackageID
	}
	return nodecommand.NewChainAuthorityResolver(rpc, original)
}

func configureChainWorker(client *ws.Client, cfg *config.Config, rpc connectionRPC, key *sui.Keypair, encryption []byte) error {
	reader, err := connectionResolver(cfg, rpc)
	if err != nil || key == nil || len(encryption) != 32 {
		return fmt.Errorf("chain worker connection requires native Host keys and pinned protocol: %v", err)
	}
	var mu sync.Mutex
	var accepted nodecommand.HostConnection
	read := func(ctx context.Context) (nodecommand.HostConnection, error) {
		if err := rpc.CheckHostJoinChain(ctx, cfg.SUI.ChainIdentifier); err != nil {
			return nodecommand.HostConnection{}, err
		}
		return reader.ReadHostConnection(ctx, cfg.SUI.OrgID, key.Public, encryption)
	}
	client.SetAuth(key, "") // the pin comes from the exact current chain binding, never TOFU
	client.SetChainAuthority(func(ctx context.Context) (string, string, error) {
		current, err := read(ctx)
		if err != nil {
			return "", "", err
		}
		endpoint, err := current.WebSocketURL()
		if err != nil {
			return "", "", err
		}
		mu.Lock()
		accepted = current
		mu.Unlock()
		return endpoint, current.CoordinatorAddress, nil
	}, func(ctx context.Context) error {
		current, err := read(ctx)
		if err != nil {
			return err
		}
		mu.Lock()
		previous := accepted
		mu.Unlock()
		if previous.MembershipID == "" || current.MembershipID != previous.MembershipID || current.MembershipVersion != previous.MembershipVersion || current.BindingID != previous.BindingID || current.BindingVersion != previous.BindingVersion || current.CoordinatorAddress != previous.CoordinatorAddress || current.Endpoint != previous.Endpoint {
			return fmt.Errorf("chain connection changed; reconnect and reauthenticate")
		}
		return nil
	})
	return nil
}

func configureChainCoordinator(server *coordinator.Server, cfg *config.Config, rpc connectionRPC, key *sui.Keypair) error {
	reader, err := connectionResolver(cfg, rpc)
	if err != nil || key == nil || cfg.Coordinator.BindingID == "" {
		return fmt.Errorf("chain Coordinator requires its binding ID, native signer and pinned chain: %v", err)
	}
	server.SetAuth(key, cfg.Coordinator.AllowedSigners)
	server.SetWorkerAuthority(func(ctx context.Context, address string, public []byte) error {
		if err := rpc.CheckHostJoinChain(ctx, cfg.SUI.ChainIdentifier); err != nil {
			return err
		}
		binding, err := reader.ReadCoordinatorConnection(ctx, cfg.SUI.OrgID, cfg.Coordinator.BindingID, key.Public)
		if err != nil {
			return err
		}
		worker, err := reader.ReadHostConnection(ctx, cfg.SUI.OrgID, public, nil)
		if err != nil {
			return err
		}
		if worker.HostAddress != address || worker.BindingID != binding.BindingID || worker.BindingVersion != binding.BindingVersion || worker.CoordinatorPublicKey != hex.EncodeToString(key.Public) || worker.Endpoint != binding.Endpoint {
			return fmt.Errorf("Host belongs to another Coordinator binding")
		}
		return nil
	})
	return nil
}
