package sui

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strconv"
	"time"

	"github.com/block-vision/sui-go-sdk/models"
	"github.com/block-vision/sui-go-sdk/utils"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/nodecommand"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/productcrypto"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/runtimeadapter"
)

type ExecutionResultReader interface {
	nodecommand.ChainExecutionReader
	ReadExecutionResult(context.Context, string, string) (nodecommand.ChainExecutionResult, bool, error)
	ReadResultKey(context.Context, string, string, uint64) (nodecommand.ChainResultKeyGrant, error)
	CurrentRecordKeyVersion(context.Context, string) (uint64, error)
}

// HostEncryptionSecret returns a fresh owned copy from local secure storage.
// The store clears it after use and never writes keys or plaintext to disk.
type HostEncryptionSecret func(context.Context) ([]byte, error)

type ResultStoreRPC interface {
	RPCClient
	SuiXGetCoins(context.Context, models.SuiXGetCoinsRequest) (models.PaginatedCoinsResponse, error)
}

var errHostGasInsufficient = errors.New("Host SUI balance cannot cover the configured gas ceilings")

type ChainExecutionStore struct {
	reader    ExecutionResultReader
	rpc       ResultStoreRPC
	signer    *Keypair
	packageID string
	secret    HostEncryptionSecret
	gasBudget uint64
}

// ResultGasBudget is a ceiling, not an actual fee. The default accommodates the
// validated 64 KiB encrypted-body bound; Sui charges actual execution/storage.
type ChainExecutionStoreOptions struct{ ResultGasBudget uint64 }

func NewChainExecutionStore(reader ExecutionResultReader, rpc ResultStoreRPC, signer *Keypair, packageID string, secret HostEncryptionSecret, options ...ChainExecutionStoreOptions) (*ChainExecutionStore, error) {
	if reader == nil || rpc == nil || signer == nil || secret == nil {
		return nil, fmt.Errorf("chain reader, transport, Host signer and secure encryption-key provider are required")
	}
	canonical, err := normalizeAddress(packageID)
	if err != nil {
		return nil, err
	}
	if len(options) > 1 {
		return nil, fmt.Errorf("at most one result store options value is supported")
	}
	budget := uint64(2000000000)
	if len(options) == 1 && options[0].ResultGasBudget != 0 {
		budget = options[0].ResultGasBudget
	}
	return &ChainExecutionStore{reader: reader, rpc: rpc, signer: signer, packageID: canonical, secret: secret, gasBudget: budget}, nil
}

func commandReservation(command nodecommand.NodeCommand) (nodecommand.Reservation, error) {
	data, err := command.SigningBytes()
	if err != nil {
		return nodecommand.Reservation{}, err
	}
	hash := sha256.Sum256(data)
	return nodecommand.Reservation{CapabilityID: command.Capability.ID, Signer: command.Signer, CommandID: command.CommandID, Nonce: command.Nonce, IdempotencyKey: command.IdempotencyKey, Fingerprint: hex.EncodeToString(hash[:]), Budget: command.Budget, Target: command.Target, Action: command.Action, CommandScope: command.Scope, IssuedAtMS: command.IssuedAtMS, ExpiresAtMS: command.ExpiresAtMS}, nil
}
func (s *ChainExecutionStore) lookup(ctx context.Context, command nodecommand.NodeCommand) (nodecommand.ChainExecution, nodecommand.Reservation, error) {
	reservation, err := commandReservation(command)
	if err != nil {
		return nodecommand.ChainExecution{}, reservation, err
	}
	run, found, err := s.reader.LookupExecution(ctx, reservation.CapabilityID, reservation.Fingerprint)
	if err != nil {
		return run, reservation, err
	}
	if !found || !run.Matches(reservation) || run.HostAddress != s.signer.Address() {
		return run, reservation, fmt.Errorf("exact command checkpoint for this Host is required")
	}
	return run, reservation, nil
}
func unknownResult(run nodecommand.ChainExecution, digest string, cause error) error {
	return &nodecommand.RejectionError{Code: nodecommand.CodeExecutionUnknown, Message: "execution result is not confirmed; query the checkpoint before any retry", Cause: cause, ExecutionID: run.ID, TransactionDigest: digest}
}
func (s *ChainExecutionStore) resultKey(ctx context.Context, run nodecommand.ChainExecution, version uint64) ([]byte, error) {
	grant, err := s.reader.ReadResultKey(ctx, run.CapabilityID, run.Fingerprint, version)
	if err != nil {
		return nil, err
	}
	if grant.OrganizationID != run.Target.OrganizationID || grant.MembershipID != run.MembershipID || grant.HostAddress != run.HostAddress || grant.KeyVersion != version {
		return nil, fmt.Errorf("result key recipient mismatch")
	}
	context, err := productcrypto.CommandResultWrapContext(grant.OrganizationID, run.CapabilityID, grant.MembershipID, run.Fingerprint, version)
	if err != nil {
		return nil, err
	}
	secret, err := s.secret(ctx)
	if err != nil {
		return nil, err
	}
	defer clear(secret)
	return productcrypto.UnwrapResultKey(grant.WrappedKey, secret, context)
}
func (s *ChainExecutionStore) Preflight(ctx context.Context, command nodecommand.NodeCommand) error {
	run, _, err := s.lookup(ctx, command)
	if err != nil {
		return err
	}
	task, err := nativeMeasurementTask(command)
	if err != nil {
		return err
	}
	if task != nil && (run.State == 0 || run.State == 1) {
		reader, ok := s.reader.(okrObservationReader)
		if !ok || run.Contract == nil {
			return fmt.Errorf("native measurement requires an OKR observation reader and bound Run")
		}
		state, err := reader.ReadOkrObservationState(ctx, run)
		if err != nil {
			return err
		}
		if state.Baseline != 0 || state.Target != uint64(len(task.Files)) {
			return fmt.Errorf("approved metric must count the signed file goals")
		}
	}
	if run.State == 5 && run.ResultRecordID == "" {
		return nil
	}
	version, err := s.reader.CurrentRecordKeyVersion(ctx, run.Target.OrganizationID)
	if run.ResultRecordID != "" {
		result, found, readErr := s.reader.ReadExecutionResult(ctx, run.CapabilityID, run.Fingerprint)
		if readErr != nil {
			return readErr
		}
		if !found {
			return unknownResult(run, "", fmt.Errorf("missing recorded result"))
		}
		version, err = result.KeyVersion, nil
	}
	if err != nil {
		return err
	}
	key, err := s.resultKey(ctx, run, version)
	if err != nil {
		return unknownResult(run, "", fmt.Errorf("result key unavailable: %w", err))
	}
	clear(key)
	if run.State == 0 || run.State == 1 {
		if err := s.checkResultGas(ctx, run.State == 0, task != nil); err != nil {
			code, message := nodecommand.CodeHostGasUnavailable, "Host SUI balance could not be verified; execution has not been authorized"
			if errors.Is(err, errHostGasInsufficient) {
				code, message = nodecommand.CodeHostGasInsufficient, "Host needs SUI for start and encrypted result publication before executing"
			}
			return &nodecommand.RejectionError{Code: code, Message: message, Cause: err, ExecutionID: run.ID}
		}
	}
	return nil
}

// This is a prerequisite check, not a reservation or a fee quote. Other Host
// transactions may consume coins later; a failed publication remains unknown.
func (s *ChainExecutionStore) checkResultGas(ctx context.Context, queued, observation bool) error {
	remaining := s.gasBudget
	if observation {
		if remaining > ^uint64(0)-observationGasBudget {
			return fmt.Errorf("gas ceiling overflow")
		}
		remaining += observationGasBudget
	}
	if queued {
		const startGasBudget = uint64(100000000)
		if remaining > ^uint64(0)-startGasBudget {
			return fmt.Errorf("gas ceiling overflow")
		}
		remaining += startGasBudget
	}
	cursor := ""
	seen := map[string]bool{}
	for {
		coins, err := s.rpc.SuiXGetCoins(ctx, models.SuiXGetCoinsRequest{Owner: s.signer.Address(), CoinType: "0x2::sui::SUI", Limit: 100, Cursor: cursor})
		if err != nil {
			return err
		}
		for _, coin := range coins.Data {
			balance, err := strconv.ParseUint(coin.Balance, 10, 64)
			if err != nil {
				return fmt.Errorf("invalid Host SUI coin balance")
			}
			if balance >= remaining {
				return nil
			}
			remaining -= balance
		}
		if !coins.HasNextPage {
			return errHostGasInsufficient
		}
		if coins.NextCursor == "" || seen[coins.NextCursor] {
			return fmt.Errorf("invalid Host coin pagination")
		}
		seen[coins.NextCursor] = true
		cursor = coins.NextCursor
	}
}

func (s *ChainExecutionStore) ConfirmStart(ctx context.Context, command nodecommand.NodeCommand, started *nodecommand.ChainExecution) error {
	run, _, err := s.lookup(ctx, command)
	if err != nil {
		return err
	}
	if started == nil || run.State != 1 || run.ID != started.ID || run.AttemptID == "" || run.AttemptID != started.AttemptID {
		return unknownResult(run, "", fmt.Errorf("chain start ownership is not current"))
	}
	return s.Preflight(ctx, command)
}

func resultContext(run nodecommand.ChainExecution, version uint64) string {
	return "fractalmind.product-record.v1:" + run.Target.OrganizationID + ":5:\"command-" + run.Fingerprint + "\":1:" + strconv.FormatUint(version, 10)
}
func validateExecutionRecord(command nodecommand.NodeCommand, record runtimeadapter.ExecutionRecord) error {
	if record.Version != "1" || record.Response.CommandID != command.CommandID || record.Event.CommandID != command.CommandID || record.Event.Target != command.Target || record.Event.Version != nodecommand.ProtocolVersion || string(record.Response.Operation) != command.Action {
		return fmt.Errorf("stored runtime record does not match the command")
	}
	return record.Response.Validate(runtimeadapter.Request{SchemaVersion: runtimeadapter.SchemaVersion, CommandID: command.CommandID, Operation: runtimeadapter.Operation(command.Action)})
}
func (s *ChainExecutionStore) LoadCommand(ctx context.Context, command nodecommand.NodeCommand) (runtimeadapter.ExecutionRecord, bool, error) {
	run, _, err := s.lookup(ctx, command)
	if err != nil {
		return runtimeadapter.ExecutionRecord{}, false, err
	}
	if run.State == 5 && run.ResultRecordID == "" {
		if run.AttemptID != "" || run.BudgetSpent != 0 || !run.StopRequested {
			return runtimeadapter.ExecutionRecord{}, false, fmt.Errorf("invalid pre-start cancellation")
		}
		record := runtimeadapter.ExecutionRecord{Version: "1", Response: runtimeadapter.Response{SchemaVersion: runtimeadapter.SchemaVersion, Adapter: runtimeadapter.AdapterName, CommandID: command.CommandID, Operation: runtimeadapter.Operation(command.Action), ObservedAt: time.UnixMilli(run.UpdatedAtMS).UTC().Format(time.RFC3339Nano), Error: &runtimeadapter.Error{Code: "cancelled", Message: "Command was cancelled before start."}, ExecutionID: run.ID, ExecutionState: "cancelled"}, Event: nodecommand.NodeEvent{Version: nodecommand.ProtocolVersion, CommandID: command.CommandID, Target: command.Target, Type: "runtime_cancelled", ResultCode: "runtime_cancelled", OccurredAtMS: run.UpdatedAtMS}, ErrorCode: "cancelled", ErrorMessage: "Command was cancelled before start."}
		return record, true, nil
	}
	result, found, err := s.reader.ReadExecutionResult(ctx, run.CapabilityID, run.Fingerprint)
	if err != nil || !found {
		return runtimeadapter.ExecutionRecord{}, false, err
	}
	key, err := s.resultKey(ctx, run, result.KeyVersion)
	if err != nil {
		return runtimeadapter.ExecutionRecord{}, false, err
	}
	defer clear(key)
	plaintext, err := productcrypto.DecryptCommandResult(result.EncryptedBody, key, resultContext(run, result.KeyVersion))
	if err != nil {
		return runtimeadapter.ExecutionRecord{}, false, err
	}
	defer clear(plaintext)
	decoder := json.NewDecoder(bytes.NewReader(plaintext))
	decoder.DisallowUnknownFields()
	var record runtimeadapter.ExecutionRecord
	if err := decoder.Decode(&record); err != nil {
		return record, false, err
	}
	var trailing any
	if err := decoder.Decode(&trailing); err != io.EOF {
		return record, false, fmt.Errorf("trailing execution record data")
	}
	if err := validateExecutionRecord(command, record); err != nil {
		return record, false, err
	}
	state, spent, err := settlement(command, record, run.StopRequested)
	if err != nil || state != run.State || record.Response.ExecutionID != run.ID || record.Response.ExecutionState != executionState(run.State) || record.Response.RequiresConfirmation != (run.State == 4) || (run.State != 4 && uint64(run.BudgetSpent) != spent) {
		return record, false, fmt.Errorf("runtime result disagrees with the chain state or settled spend")
	}
	record.Response.ExecutionID = run.ID
	record.Response.ExecutionState = executionState(run.State)
	record.Response.RequiresConfirmation = run.State == 4
	// Never recover a transaction digest from runtime-provided plaintext. The
	// immutable chain result's creation transaction is the durable source.
	record.Response.TransactionDigest = result.TransactionDigest
	s.observeNativeResult(ctx, command, &record, false)
	return record, true, nil
}
func executionState(state uint8) string {
	return [...]string{"queued", "running", "succeeded", "failed", "needs_confirmation", "cancelled"}[state]
}

func settlement(command nodecommand.NodeCommand, record runtimeadapter.ExecutionRecord, stopping bool) (uint8, uint64, error) {
	state := uint8(3)
	if record.Response.OK {
		state = 2
	}
	if record.Event.Type == "runtime_rejected" {
		return 3, 0, nil
	}
	if record.ErrorMessage != "" {
		return 4, 0, nil
	}
	if stopping && record.Response.Error != nil && record.Response.Error.Code == "cancelled" {
		state = 5
	}
	if command.Budget == nil {
		return state, 0, nil
	}
	spend := record.Response.Spend
	if spend == nil || !spend.Known {
		return 4, 0, nil
	}
	if spend.Asset != command.Budget.Asset || spend.Amount > command.Budget.Amount {
		return 0, 0, fmt.Errorf("runtime spend exceeds signed budget or changes its asset")
	}
	return state, uint64(spend.Amount), nil
}
func (s *ChainExecutionStore) SaveCommand(ctx context.Context, command nodecommand.NodeCommand, started *nodecommand.ChainExecution, record runtimeadapter.ExecutionRecord) (runtimeadapter.ExecutionRecord, error) {
	run, _, err := s.lookup(ctx, command)
	if err != nil {
		return record, err
	}
	if started == nil || run.State != 1 || run.ID != started.ID || run.AttemptID == "" || run.AttemptID != started.AttemptID {
		return record, unknownResult(run, "", fmt.Errorf("start ownership changed"))
	}
	if err := validateExecutionRecord(command, record); err != nil {
		return record, unknownResult(run, "", err)
	}
	state, spent, err := settlement(command, record, run.StopRequested)
	if err != nil {
		return record, unknownResult(run, "", err)
	}
	version, err := s.reader.CurrentRecordKeyVersion(ctx, run.Target.OrganizationID)
	if err != nil {
		return record, unknownResult(run, "", err)
	}
	key, err := s.resultKey(ctx, run, version)
	if err != nil {
		return record, unknownResult(run, "", err)
	}
	defer clear(key)
	record.Response.ExecutionID = run.ID
	record.Response.ExecutionState = executionState(state)
	record.Response.RequiresConfirmation = state == 4
	if state == 4 {
		record.Event.ResultCode = "runtime_needs_confirmation"
	}
	plaintext, err := json.Marshal(record)
	if err != nil {
		return record, unknownResult(run, "", err)
	}
	defer clear(plaintext)
	encrypted, err := productcrypto.EncryptCommandResult(plaintext, key, resultContext(run, version))
	if err != nil {
		return record, unknownResult(run, "", err)
	}
	args := []interface{}{ObjectArgument(run.ID), ObjectArgument(run.CapabilityID), ObjectArgument(run.Target.OrganizationID), state, strconv.FormatUint(run.Cursor, 10), strconv.FormatUint(spent, 10), strconv.FormatUint(version, 10), ChunkedBytes(encrypted), ObjectArgument("0x6")}
	module, function := "node_execution", "finish_command_with_budget"
	if run.Contract != nil {
		module, function = "okr", "finish_command"
		args = append([]interface{}{ObjectArgument(run.Contract.ID)}, args...)
	}
	tx, err := s.rpc.MoveCall(ctx, models.MoveCallRequest{Signer: s.signer.Address(), PackageObjectId: s.packageID, Module: module, Function: function, Arguments: args, TypeArguments: []interface{}{}, GasBudget: strconv.FormatUint(s.gasBudget, 10)})
	if err != nil {
		return record, unknownResult(run, "", err)
	}
	digest, err := utils.GetTxDigest(tx.TxBytes)
	if err != nil {
		return record, unknownResult(run, "", err)
	}
	receipt, err := s.rpc.SignAndExecuteTransactionBlock(ctx, models.SignAndExecuteTransactionBlockRequest{TxnMetaData: tx, PriKey: s.signer.Private, Options: models.SuiTransactionBlockOptions{ShowEffects: true}, RequestType: "WaitForLocalExecution"})
	if err != nil || receipt.Digest != digest || receipt.Effects.Status.Status != "success" {
		if err == nil {
			err = fmt.Errorf("result transaction receipt: digest %q, status %q, error %q", receipt.Digest, receipt.Effects.Status.Status, receipt.Effects.Status.Error)
		}
		return record, unknownResult(run, digest, err)
	}
	hash := sha256.Sum256(encrypted)
	confirmed := false
	queryCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	for !confirmed {
		result, found, readErr := s.reader.ReadExecutionResult(queryCtx, run.CapabilityID, run.Fingerprint)
		if readErr == nil && found {
			if result.Execution.State != state || result.Execution.AttemptID != run.AttemptID || result.Execution.ResultHash != hex.EncodeToString(hash[:]) {
				return record, unknownResult(run, digest, fmt.Errorf("another terminal result owns the checkpoint"))
			}
			confirmed = true
			break
		}
		select {
		case <-queryCtx.Done():
			return record, unknownResult(run, digest, queryCtx.Err())
		case <-time.After(100 * time.Millisecond):
		}
	}
	record.Response.TransactionDigest = digest
	s.observeNativeResult(ctx, command, &record, true)
	return record, nil
}

var _ runtimeadapter.CommandExecutionStore = (*ChainExecutionStore)(nil)
