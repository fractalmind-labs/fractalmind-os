package sui

import (
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"sync"
	"testing"

	"github.com/block-vision/sui-go-sdk/models"
	"github.com/block-vision/sui-go-sdk/utils"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/nodecommand"
)

type executionLookupFunc func(context.Context, string, string) (nodecommand.ChainExecution, bool, error)

func (f executionLookupFunc) LookupExecution(ctx context.Context, cap, hash string) (nodecommand.ChainExecution, bool, error) {
	return f(ctx, cap, hash)
}

type reservationRPC struct {
	RPCClient
	build func(models.MoveCallRequest) (models.TxnMetaData, error)
	send  func(models.SignAndExecuteTransactionBlockRequest) (models.SuiTransactionBlockResponse, error)
	coins func(models.SuiXGetCoinsRequest) (models.PaginatedCoinsResponse, error)
}

func (r *reservationRPC) SuiXGetCoins(_ context.Context, req models.SuiXGetCoinsRequest) (models.PaginatedCoinsResponse, error) {
	if r.coins != nil {
		return r.coins(req)
	}
	return models.PaginatedCoinsResponse{Data: []models.CoinData{{Balance: "3000000000"}}}, nil
}

func (r *reservationRPC) MoveCall(_ context.Context, req models.MoveCallRequest) (models.TxnMetaData, error) {
	return r.build(req)
}
func (r *reservationRPC) SignAndExecuteTransactionBlock(_ context.Context, req models.SignAndExecuteTransactionBlockRequest) (models.SuiTransactionBlockResponse, error) {
	return r.send(req)
}

func reservationFixture(t *testing.T) (*Keypair, nodecommand.ChainExecution, nodecommand.Reservation, nodecommand.CapabilityState) {
	t.Helper()
	_, private, err := ed25519.GenerateKey(nil)
	if err != nil {
		t.Fatal(err)
	}
	kp := &Keypair{Private: private, Public: private.Public().(ed25519.PublicKey)}
	t.Cleanup(func() { clear(private) })
	run := nodecommand.ChainExecution{ID: "0x1", CapabilityID: "0x2", HumanID: "0x3", GrantID: "0x4", MembershipID: "0x5", CoordinatorBindingID: "0x6", ManagedAgentID: "0x7", HostAddress: kp.Address(), Signer: "device", CommandID: "cmd", Nonce: "nonce", IdempotencyKey: "idem", Fingerprint: "intent", Action: "assign", Scope: "control", Target: nodecommand.Target{OrganizationID: "0x8", NodeID: kp.Address(), AgentID: "agent"}, CapabilityVersion: 1, Cursor: 1, IssuedAtMS: 1, ExpiresAtMS: 100, Budget: &nodecommand.BudgetClaim{Asset: "MIST", Amount: 10}}
	r := nodecommand.Reservation{CapabilityID: run.CapabilityID, Signer: run.Signer, CommandID: run.CommandID, Nonce: run.Nonce, IdempotencyKey: run.IdempotencyKey, Fingerprint: run.Fingerprint, Action: run.Action, CommandScope: run.Scope, Target: run.Target, IssuedAtMS: run.IssuedAtMS, ExpiresAtMS: run.ExpiresAtMS, Budget: run.Budget}
	return kp, run, r, nodecommand.CapabilityState{RevocationVersion: 1}
}

func attemptFromCall(req models.MoveCallRequest) string {
	values := req.Arguments[len(req.Arguments)-2].([]interface{})
	bytes := make([]byte, len(values))
	for i, value := range values {
		var n int
		fmt.Sscan(fmt.Sprint(value), &n)
		bytes[i] = byte(n)
	}
	return hex.EncodeToString(bytes)
}

func txResponse(t *testing.T, meta models.TxnMetaData, status string) models.SuiTransactionBlockResponse {
	t.Helper()
	digest, err := utils.GetTxDigest(meta.TxBytes)
	if err != nil {
		t.Fatal(err)
	}
	return models.SuiTransactionBlockResponse{Digest: digest, Effects: models.SuiEffects{Status: models.ExecutionStatus{Status: status}}}
}

func TestChainStartConfirmsOwnAttemptAfterLedgerLag(t *testing.T) {
	kp, run, r, state := reservationFixture(t)
	reads, sends := 0, 0
	var attempt string
	reader := executionLookupFunc(func(context.Context, string, string) (nodecommand.ChainExecution, bool, error) {
		reads++
		if reads >= 3 {
			run.State = 1
			run.Cursor = 2
			run.AttemptID = attempt
		}
		return run, true, nil
	})
	rpc := &reservationRPC{
		build: func(req models.MoveCallRequest) (models.TxnMetaData, error) {
			if req.Function != "begin_agent_command" {
				t.Fatalf("wrong entry %s", req.Function)
			}
			for _, index := range []int{0, 1, 2, 3, 4, 5, 6, 7, 9} {
				if _, ok := req.Arguments[index].(ObjectArgument); !ok {
					t.Fatalf("argument %d was not an object reference", index)
				}
			}
			attempt = attemptFromCall(req)
			return models.TxnMetaData{TxBytes: base64.StdEncoding.EncodeToString([]byte(attempt))}, nil
		},
		send: func(req models.SignAndExecuteTransactionBlockRequest) (models.SuiTransactionBlockResponse, error) {
			sends++
			return txResponse(t, req.TxnMetaData, "success"), nil
		},
	}
	backend, err := NewChainReservations(reader, rpc, kp, "0x42")
	if err != nil {
		t.Fatal(err)
	}
	result, err := backend.Reserve(context.Background(), r, state)
	if err != nil || result.Duplicate || result.Execution == nil || result.Execution.AttemptID != attempt || result.TransactionDigest == "" {
		t.Fatalf("reservation=%+v err=%v", result, err)
	}
	if sends != 1 || reads != 3 {
		t.Fatalf("sends=%d reads=%d", sends, reads)
	}
	duplicate, found, err := backend.Inspect(context.Background(), r)
	if err != nil || !found || !duplicate.Duplicate || duplicate.Execution.ID != run.ID || sends != 1 {
		t.Fatalf("duplicate=%+v found=%t err=%v", duplicate, found, err)
	}
}

func TestChainStartUnknownNeverResendsOrAdoptsAnotherAttempt(t *testing.T) {
	for _, mode := range []string{"receipt lost", "different digest", "another attempt", "known rejection"} {
		t.Run(mode, func(t *testing.T) {
			kp, run, r, state := reservationFixture(t)
			sends := 0
			reader := executionLookupFunc(func(context.Context, string, string) (nodecommand.ChainExecution, bool, error) { return run, true, nil })
			rpc := &reservationRPC{
				build: func(models.MoveCallRequest) (models.TxnMetaData, error) {
					return models.TxnMetaData{TxBytes: base64.StdEncoding.EncodeToString([]byte("prepared start"))}, nil
				},
				send: func(req models.SignAndExecuteTransactionBlockRequest) (models.SuiTransactionBlockResponse, error) {
					sends++
					run.State = 1
					run.AttemptID = "another process"
					switch mode {
					case "receipt lost":
						return models.SuiTransactionBlockResponse{}, errors.New("connection reset after send")
					case "different digest":
						return models.SuiTransactionBlockResponse{Digest: "unexpected"}, nil
					case "known rejection":
						run.State = 0
						return txResponse(t, req.TxnMetaData, "failure"), errors.New("authority revoked before start")
					default:
						return txResponse(t, req.TxnMetaData, "success"), nil
					}
				},
			}
			backend, _ := NewChainReservations(reader, rpc, kp, "0x42")
			_, err := backend.Reserve(context.Background(), r, state)
			var rejected *nodecommand.RejectionError
			if !errors.As(err, &rejected) || rejected.TransactionDigest == "" || rejected.ExecutionID != run.ID {
				t.Fatalf("missing confirmation identity: %v", err)
			}
			want := nodecommand.CodeExecutionUnknown
			if mode == "known rejection" {
				want = nodecommand.CodeExecutionStartRejected
			}
			if rejected.Code != want || sends != 1 {
				t.Fatalf("err=%v sends=%d", err, sends)
			}
		})
	}
}

func TestConcurrentHostStartsUseDifferentAttemptsAndOnlyWinnerMayRun(t *testing.T) {
	kp, run, r, state := reservationFixture(t)
	var mu sync.Mutex
	barrier := make(chan struct{})
	attempts := make(map[string]bool)
	sends := 0
	reader := executionLookupFunc(func(context.Context, string, string) (nodecommand.ChainExecution, bool, error) {
		mu.Lock()
		defer mu.Unlock()
		return run, true, nil
	})
	rpc := &reservationRPC{
		build: func(req models.MoveCallRequest) (models.TxnMetaData, error) {
			attempt := attemptFromCall(req)
			mu.Lock()
			if attempts[attempt] {
				t.Error("two starters produced the same attempt")
			}
			attempts[attempt] = true
			if len(attempts) == 2 {
				close(barrier)
			}
			mu.Unlock()
			<-barrier
			return models.TxnMetaData{TxBytes: base64.StdEncoding.EncodeToString([]byte(attempt))}, nil
		},
		send: func(req models.SignAndExecuteTransactionBlockRequest) (models.SuiTransactionBlockResponse, error) {
			mu.Lock()
			defer mu.Unlock()
			sends++
			if run.State == 1 {
				return txResponse(t, req.TxnMetaData, "failure"), errors.New("checkpoint already started")
			}
			bytes, _ := base64.StdEncoding.DecodeString(req.TxnMetaData.TxBytes)
			run.State = 1
			run.AttemptID = string(bytes)
			run.Cursor = 2
			return txResponse(t, req.TxnMetaData, "success"), nil
		},
	}
	backend, _ := NewChainReservations(reader, rpc, kp, "0x42")
	errorsCh := make(chan error, 2)
	for range 2 {
		go func() { _, err := backend.Reserve(context.Background(), r, state); errorsCh <- err }()
	}
	winners, rejected := 0, 0
	for range 2 {
		if err := <-errorsCh; err == nil {
			winners++
		} else if nodecommand.CodeOf(err) == nodecommand.CodeExecutionStartRejected {
			rejected++
		} else {
			t.Error(err)
		}
	}
	if winners != 1 || rejected != 1 || sends != 2 || len(attempts) != 2 {
		t.Fatalf("winners=%d rejected=%d sends=%d attempts=%d", winners, rejected, sends, len(attempts))
	}
}

func TestUnpreparedOrChangedIntentCannotSendStart(t *testing.T) {
	for _, mode := range []string{"absent", "payload intent", "nonce", "scope", "budget", "Host"} {
		t.Run(mode, func(t *testing.T) {
			kp, run, r, state := reservationFixture(t)
			switch mode {
			case "payload intent":
				run.Fingerprint = "changed"
			case "nonce":
				run.Nonce = "changed"
			case "scope":
				run.Scope = "changed"
			case "budget":
				r.Budget = &nodecommand.BudgetClaim{Asset: "MIST", Amount: 11}
			case "Host":
				run.HostAddress = "other"
			}
			reader := executionLookupFunc(func(context.Context, string, string) (nodecommand.ChainExecution, bool, error) {
				return run, mode != "absent", nil
			})
			rpc := &reservationRPC{build: func(models.MoveCallRequest) (models.TxnMetaData, error) {
				t.Fatal("unauthorized intent reached transaction builder")
				return models.TxnMetaData{}, nil
			}}
			backend, _ := NewChainReservations(reader, rpc, kp, "0x42")
			if _, err := backend.Reserve(context.Background(), r, state); nodecommand.CodeOf(err) != nodecommand.CodeUnauthorized {
				t.Fatalf("expected unauthorized, got %v", err)
			}
		})
	}
}
