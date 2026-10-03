package main

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"encoding/json"
	"fmt"
	"io"

	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/config"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/hostidentity"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/nodecommand"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/sui"
)

type stoppedReviewInput struct {
	ExecutionID string                  `json:"execution_id"`
	Command     nodecommand.NodeCommand `json:"command"`
}

func decodeStoppedReview(input io.Reader) (stoppedReviewInput, error) {
	var value stoppedReviewInput
	data, err := io.ReadAll(io.LimitReader(input, 128*1024+1))
	if err != nil || len(data) > 128*1024 {
		return value, fmt.Errorf("stopped review input exceeds its bound")
	}
	defer clear(data)
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&value); err != nil {
		return value, fmt.Errorf("invalid stopped review input")
	}
	var trailing any
	if err := decoder.Decode(&trailing); err != io.EOF {
		return value, fmt.Errorf("trailing stopped review input")
	}
	canonical, err := canonicalObjectID(value.ExecutionID)
	if err != nil || canonical != value.ExecutionID {
		return value, fmt.Errorf("canonical original execution ID is required")
	}
	return value, nil
}

// This command only opens the existing Host credential profile and result
// store. No runtime adapter, background queue, key initialization or server is
// started. Signed input is stdin-only and never echoed to diagnostics.
func runStoppedReviewCLI(ctx context.Context, cfg *config.Config, input io.Reader, output io.Writer) error {
	value, err := decodeStoppedReview(input)
	if err != nil {
		return err
	}
	enabled, err := runtimeConfigurationEnabled(cfg)
	if err != nil || !enabled {
		return fmt.Errorf("stopped review requires the configured chain runtime: %v", err)
	}
	org, err := canonicalObjectID(cfg.SUI.OrgID)
	if err != nil || value.Command.Target.OrganizationID != org {
		return fmt.Errorf("original review must belong to the configured organization")
	}
	native, err := hostidentity.OpenNativeStoreWithCollection(cfg.Identity.SecretServiceCollection)
	if err != nil {
		return err
	}
	keys, err := hostidentity.Load(native, cfg.Identity.KeyProfile)
	if err != nil {
		return err
	}
	defer keys.Close()
	private, err := keys.SigningPrivate()
	if err != nil {
		return err
	}
	defer clear(private)
	signer := &sui.Keypair{Private: private, Public: private.Public().(ed25519.PublicKey)}
	if value.Command.Target.NodeID != signer.Address() || cfg.Identity.HostID != "" && cfg.Identity.HostID != signer.Address() {
		return fmt.Errorf("original review must target this existing Host identity")
	}
	rpc, err := sui.NewGRPCClient(cfg.SUI.RPC, cfg.SUI.GraphQLURL)
	if err != nil {
		return err
	}
	defer rpc.Close()
	if err := rpc.CheckHostJoinChain(ctx, cfg.SUI.ChainIdentifier); err != nil {
		return err
	}
	original := cfg.SUI.ProtocolOriginalPackageID
	if original == "" {
		original = cfg.SUI.ProtocolPackageID
	}
	reader, err := nodecommand.NewChainAuthorityResolverForPackage(rpc, cfg.SUI.ProtocolPackageID, original, okrTypeOrigin(cfg), directTypeOrigin(cfg))
	if err != nil {
		return err
	}
	store, err := sui.NewChainExecutionStore(reader, rpc, signer, cfg.SUI.ProtocolPackageID, keys.EncryptionSecret, sui.ChainExecutionStoreOptions{ResultGasBudget: cfg.Runtime.ResultGasBudget, OkrPackageID: cfg.SUI.OkrPackageID, DirectPackageID: cfg.SUI.DirectPackageID})
	if err != nil {
		return err
	}
	record, err := store.SettleStoppedHandoverReview(ctx, value.ExecutionID, value.Command)
	result := struct {
		ExecutionID       string `json:"execution_id"`
		State             string `json:"state"`
		TransactionDigest string `json:"transaction_digest,omitempty"`
		Code              string `json:"code,omitempty"`
	}{ExecutionID: value.ExecutionID, State: record.Response.ExecutionState, TransactionDigest: record.Response.TransactionDigest}
	if err != nil {
		result.State = "not_published"
		if rejection, ok := err.(*nodecommand.RejectionError); ok {
			result.Code = string(rejection.Code)
			result.TransactionDigest = rejection.TransactionDigest
			if rejection.TransactionDigest != "" {
				result.State = "unconfirmed"
			}
		}
	}
	if writeErr := json.NewEncoder(output).Encode(result); writeErr != nil {
		return writeErr
	}
	return err
}
