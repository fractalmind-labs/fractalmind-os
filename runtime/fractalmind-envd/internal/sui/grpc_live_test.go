package sui

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/block-vision/sui-go-sdk/models"
	v2 "github.com/block-vision/sui-go-sdk/pb/sui/rpc/v2"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/fieldmaskpb"
)

// This smoke test reads public testnet state and simulates an unsigned PTB.
// It never loads a wallet, signs, submits, or spends gas.
func TestLiveGRPCReadAndSimulation(t *testing.T) {
	if os.Getenv("SUI_RPC_LIVE_TEST") != "1" {
		t.Skip("set SUI_RPC_LIVE_TEST=1 for public testnet smoke checks")
	}
	c, err := NewGRPCClient("https://fullnode.testnet.sui.io:443", "https://graphql.testnet.sui.io/graphql")
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	clock, err := c.ledger.GetObject(ctx, &v2.GetObjectRequest{ObjectId: proto.String("0x6"), ReadMask: &fieldmaskpb.FieldMask{Paths: []string{"object_id", "json", "object_type"}}})
	if err != nil {
		t.Fatal(err)
	}
	if clock.GetObject().GetJson() == nil {
		t.Fatal("clock JSON missing")
	}
	_, err = c.SuiXGetOwnedObjects(ctx, models.SuiXGetOwnedObjectsRequest{Address: "0x1", Query: models.SuiObjectResponseQuery{Filter: models.ObjectFilterByStructType{StructType: "0x2::coin::Coin<0x2::sui::SUI>"}}, Limit: 1})
	if err != nil {
		t.Fatal(err)
	}
	_, err = c.SuiXQueryEvents(ctx, models.SuiXQueryEventsRequest{SuiEventFilter: models.EventFilterByMoveEventType{MoveEventType: "0x2::coin::CurrencyCreated"}, Limit: 1})
	if err != nil {
		t.Fatal(err)
	}
	in, err := literal([]any{104, 105})
	if err != nil {
		t.Fatal(err)
	}
	ptb := &v2.ProgrammableTransaction{Inputs: []*v2.Input{in}, Commands: []*v2.Command{{Command: &v2.Command_MoveCall{MoveCall: &v2.MoveCall{Package: proto.String("0x1"), Module: proto.String("ascii"), Function: proto.String("string"), Arguments: []*v2.Argument{inputArgument(0)}}}}}}
	tx := &v2.Transaction{Version: proto.Int32(1), Sender: proto.String("0x" + strings.Repeat("0", 63) + "1"), Kind: &v2.TransactionKind{Kind: v2.TransactionKind_PROGRAMMABLE_TRANSACTION.Enum(), Data: &v2.TransactionKind_ProgrammableTransaction{ProgrammableTransaction: ptb}}, GasPayment: &v2.GasPayment{Owner: proto.String("0x" + strings.Repeat("0", 63) + "1"), Price: proto.Uint64(1000), Budget: proto.Uint64(10000000)}}
	resp, err := c.execution.SimulateTransaction(ctx, &v2.SimulateTransactionRequest{Transaction: tx, Checks: v2.SimulateTransactionRequest_DISABLED.Enum(), ReadMask: &fieldmaskpb.FieldMask{Paths: []string{"transaction.transaction", "transaction.effects.status", "command_outputs"}}})
	if err != nil {
		t.Fatal(err)
	}
	if err := executionError(resp.GetTransaction()); err != nil {
		t.Fatal(err)
	}
	if len(resp.GetTransaction().GetTransaction().GetBcs().GetValue()) == 0 {
		t.Fatal("resolved BCS missing")
	}
	t.Log("gRPC object/owned-object reads, GraphQL events, and unsigned literal PTB simulation passed")
}
