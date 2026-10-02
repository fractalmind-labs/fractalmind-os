package sui

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"time"

	"github.com/block-vision/sui-go-sdk/models"
	"github.com/block-vision/sui-go-sdk/utils"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/nodecommand"
)

// ChainReservations accepts only an exact device-prepared on-chain command.
// It atomically transitions its checkpoint using the admitted Host signer.
// A read of RUNNING after a timeout never authorizes local execution.
type ChainReservations struct {
	resolver     nodecommand.ChainExecutionReader
	rpc          RPCClient
	keypair      *Keypair
	packageID    string
	okrPackageID string
}

func NewChainReservations(resolver nodecommand.ChainExecutionReader, rpc RPCClient, keypair *Keypair, packageID string, okrPackages ...string) (*ChainReservations, error) {
	if resolver == nil || rpc == nil || keypair == nil || packageID == "" {
		return nil, fmt.Errorf("chain reader, transaction transport, Host signer and package ID are required")
	}
	if len(okrPackages) > 1 {
		return nil, fmt.Errorf("at most one OKR call package is supported")
	}
	okr := packageID
	if len(okrPackages) == 1 && okrPackages[0] != "" {
		var err error
		okr, err = normalizeAddress(okrPackages[0])
		if err != nil {
			return nil, err
		}
	}
	return &ChainReservations{resolver: resolver, rpc: rpc, keypair: keypair, packageID: packageID, okrPackageID: okr}, nil
}
func (s *ChainReservations) Supports(scope nodecommand.ReservationScope) bool {
	return scope == nodecommand.ReservationScopeNode
}
func (s *ChainReservations) Inspect(ctx context.Context, r nodecommand.Reservation) (nodecommand.ReservationResult, bool, error) {
	execution, found, err := s.resolver.LookupExecution(ctx, r.CapabilityID, r.Fingerprint)
	if err != nil || !found {
		return nodecommand.ReservationResult{}, false, err
	}
	if !execution.Matches(r) || execution.HostAddress != s.keypair.Address() {
		return nodecommand.ReservationResult{}, false, &nodecommand.RejectionError{Code: nodecommand.CodeWrongTarget, Message: "prepared command does not match this intent or Host"}
	}
	if execution.State == 0 {
		return nodecommand.ReservationResult{}, false, nil
	}
	return nodecommand.ReservationResult{Duplicate: true, AuthorityCheckpoint: execution.CapabilityVersion, Execution: &execution}, true, nil
}
func (s *ChainReservations) Reserve(ctx context.Context, r nodecommand.Reservation, state nodecommand.CapabilityState) (nodecommand.ReservationResult, error) {
	execution, found, err := s.resolver.LookupExecution(ctx, r.CapabilityID, r.Fingerprint)
	if err != nil {
		return nodecommand.ReservationResult{}, err
	}
	if !found || !execution.Matches(r) || execution.HostAddress != s.keypair.Address() {
		return nodecommand.ReservationResult{}, &nodecommand.RejectionError{Code: nodecommand.CodeUnauthorized, Message: "exact device-prepared chain claim is required"}
	}
	if execution.State != 0 {
		return nodecommand.ReservationResult{Duplicate: true, AuthorityCheckpoint: execution.CapabilityVersion, Execution: &execution}, nil
	}
	if state.RevocationVersion != execution.CapabilityVersion || execution.StopRequested {
		return nodecommand.ReservationResult{}, &nodecommand.RejectionError{Code: nodecommand.CodeRevoked, Message: "prepared execution authority changed or was stopped"}
	}
	args := []interface{}{ObjectArgument(execution.ID), ObjectArgument(r.CapabilityID), ObjectArgument(execution.Target.OrganizationID), ObjectArgument(execution.HumanID), ObjectArgument(execution.GrantID), ObjectArgument(execution.MembershipID), ObjectArgument(execution.CoordinatorBindingID)}
	function := "begin_host_command"
	if execution.ManagedAgentID != "" {
		args = append(args, ObjectArgument(execution.ManagedAgentID))
		function = "begin_agent_command"
	}
	module, targetPackage := "node_execution", s.packageID
	if execution.Contract != nil {
		if state.Contract == nil || *execution.Contract != *state.Contract {
			return nodecommand.ReservationResult{}, fmt.Errorf("prepared OKR contract changed")
		}
		module, function = "okr", "begin_command"
		targetPackage = s.okrPackageID
		args = append([]interface{}{ObjectArgument(execution.Contract.ID)}, args...)
	}
	attempt := make([]byte, 32)
	if _, err = rand.Read(attempt); err != nil {
		return nodecommand.ReservationResult{}, err
	}
	args = append(args, byteVector(attempt), ObjectArgument("0x6"))
	tx, err := s.rpc.MoveCall(ctx, models.MoveCallRequest{Signer: s.keypair.Address(), PackageObjectId: targetPackage, Module: module, Function: function, Arguments: args, TypeArguments: []interface{}{}, GasBudget: "100000000"})
	if err != nil {
		return nodecommand.ReservationResult{}, err
	}
	digest, err := utils.GetTxDigest(tx.TxBytes)
	if err != nil {
		return nodecommand.ReservationResult{}, err
	}
	result, err := s.rpc.SignAndExecuteTransactionBlock(ctx, models.SignAndExecuteTransactionBlockRequest{TxnMetaData: tx, PriKey: s.keypair.Private, Options: models.SuiTransactionBlockOptions{ShowEffects: true}, RequestType: "WaitForLocalExecution"})
	if result.Digest == digest && result.Effects.Status.Status == "failure" {
		return nodecommand.ReservationResult{}, &nodecommand.RejectionError{Code: nodecommand.CodeExecutionStartRejected, Message: "chain rejected Host start; query digest " + digest, Cause: err, ExecutionID: execution.ID, TransactionDigest: digest}
	}
	if err != nil {
		return nodecommand.ReservationResult{}, &nodecommand.RejectionError{Code: nodecommand.CodeExecutionUnknown, Message: "Host start transaction was not confirmed; query digest " + digest, Cause: err, ExecutionID: execution.ID, TransactionDigest: digest}
	}
	if result.Digest != digest || result.Effects.Status.Status != "success" {
		return nodecommand.ReservationResult{}, &nodecommand.RejectionError{Code: nodecommand.CodeExecutionUnknown, Message: "Host start result is incomplete; query digest " + digest, ExecutionID: execution.ID, TransactionDigest: digest}
	}
	started, err := s.confirmStart(ctx, r, hex.EncodeToString(attempt))
	if err != nil {
		return nodecommand.ReservationResult{}, &nodecommand.RejectionError{Code: nodecommand.CodeExecutionUnknown, Message: "start ownership was not confirmed; query digest " + digest, Cause: err, ExecutionID: execution.ID, TransactionDigest: digest}
	}
	return nodecommand.ReservationResult{AuthorityCheckpoint: execution.CapabilityVersion, Execution: &started, TransactionDigest: digest}, nil
}

// A successful execution receipt can precede the ledger's latest object view.
// Poll only reads of this exact checkpoint and attempt; never send another start.
func (s *ChainReservations) confirmStart(ctx context.Context, r nodecommand.Reservation, attempt string) (nodecommand.ChainExecution, error) {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	for {
		started, found, err := s.resolver.LookupExecution(ctx, r.CapabilityID, r.Fingerprint)
		if err == nil && found && started.State != 0 {
			if started.State == 1 && started.AttemptID == attempt && started.Matches(r) && started.HostAddress == s.keypair.Address() {
				return started, nil
			}
			return nodecommand.ChainExecution{}, fmt.Errorf("checkpoint is not RUNNING under this attempt")
		}
		select {
		case <-ctx.Done():
			return nodecommand.ChainExecution{}, ctx.Err()
		case <-time.After(100 * time.Millisecond):
		}
	}
}
