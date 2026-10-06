package sui

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"errors"
	"sync/atomic"
	"testing"

	v2 "github.com/block-vision/sui-go-sdk/pb/sui/rpc/v2"
	"google.golang.org/protobuf/proto"
)

func joinReceiptFixture(t *testing.T) (HostJoinQuote, *v2.ExecutedTransaction) {
	t.Helper()
	g, i, raw := readJoinGolden(t)
	q, err := validateHostJoinBCS(raw, i)
	if err != nil {
		t.Fatal(err)
	}
	q.intent = &i
	q.broadcast = &atomic.Bool{}
	tx := &v2.ExecutedTransaction{Digest: proto.String(g.Digest), Transaction: &v2.Transaction{Bcs: &v2.Bcs{Value: raw}, Sender: proto.String(q.Sender), GasPayment: &v2.GasPayment{Owner: proto.String(q.Sender), Price: proto.Uint64(q.GasPrice), Budget: proto.Uint64(q.GasBudget)}}, Effects: &v2.TransactionEffects{TransactionDigest: proto.String(g.Digest), Status: &v2.ExecutionStatus{Success: proto.Bool(true)}, GasUsed: &v2.GasCostSummary{ComputationCost: proto.Uint64(10), StorageCost: proto.Uint64(20), StorageRebate: proto.Uint64(5)}, ChangedObjects: []*v2.ChangedObject{{ObjectId: proto.String(g.Request.InviteID), OutputVersion: proto.Uint64(12), OutputState: v2.ChangedObject_OUTPUT_OBJECT_STATE_OBJECT_WRITE.Enum()}}}}
	return q, tx
}
func TestHostJoinReceiptRequiresExactOriginalDigestAndFees(t *testing.T) {
	for _, mode := range []string{"confirmed", "failed", "digest", "effects digest", "raw bytes", "sender", "owner", "budget", "price", "status", "fee", "output version"} {
		t.Run(mode, func(t *testing.T) {
			q, tx := joinReceiptFixture(t)
			switch mode {
			case "failed":
				tx.Effects.Status.Success = proto.Bool(false)
			case "digest":
				tx.Digest = proto.String("other")
			case "effects digest":
				tx.Effects.TransactionDigest = proto.String("other")
			case "raw bytes":
				tx.Transaction.Bcs.Value[0] ^= 1
			case "sender":
				tx.Transaction.Sender = proto.String("other")
			case "owner":
				tx.Transaction.GasPayment.Owner = proto.String("other")
			case "budget":
				tx.Transaction.GasPayment.Budget = proto.Uint64(1)
			case "price":
				tx.Transaction.GasPayment.Price = proto.Uint64(1)
			case "status":
				tx.Effects.Status = nil
			case "fee":
				tx.Effects.GasUsed = nil
			case "output version":
				tx.Effects.ChangedObjects[0].OutputVersion = nil
			}
			receipt, err := parseHostJoinReceipt(tx, HostJoinReceiptRequest{Digest: q.Digest, Sender: q.Sender, GasBudget: q.GasBudget, GasPrice: q.GasPrice})
			if mode == "confirmed" || mode == "failed" {
				if err != nil || receipt.Status != mode || receipt.ActualFee != "25" {
					t.Fatalf("receipt %+v %v", receipt, err)
				}
			} else if err == nil {
				t.Fatal("incomplete or substituted receipt accepted")
			}
		})
	}
}
func TestHostJoinUnknownExecutionNeverRebroadcasts(t *testing.T) {
	q, tx := joinReceiptFixture(t)
	private := ed25519.NewKeyFromSeed(bytes.Repeat([]byte{77}, 32))
	defer clear(private)
	sig, err := SignHostJoinQuote(q, private)
	if err != nil {
		t.Fatal(err)
	}
	calls := 0
	s := &transportServer{execute: func(req *v2.ExecuteTransactionRequest) (*v2.ExecuteTransactionResponse, error) {
		calls++
		if !bytes.Equal(req.Transaction.GetBcs().GetValue(), tx.Transaction.Bcs.Value) {
			t.Fatal("broadcast changed quote")
		}
		return nil, errors.New("execution response lost")
	}, query: func(req *v2.GetTransactionRequest) (*v2.GetTransactionResponse, error) {
		if req.GetDigest() != q.Digest {
			t.Fatal("query substituted original")
		}
		return &v2.GetTransactionResponse{Transaction: tx}, nil
	}}
	c := testTransport(t, s)
	if _, err = c.ExecuteHostJoin(context.Background(), q, sig); err == nil {
		t.Fatal("lost response reported as success")
	}
	if _, err = c.ExecuteHostJoin(context.Background(), q, sig); err == nil || calls != 1 {
		t.Fatal("unknown operation was rebroadcast")
	}
	r, err := c.QueryHostJoin(context.Background(), HostJoinReceiptRequest{Digest: q.Digest, Sender: q.Sender, GasBudget: q.GasBudget, GasPrice: q.GasPrice})
	if err != nil || r.Status != "confirmed" || r.ActualFee != "25" || calls != 1 {
		t.Fatalf("original query failed %+v %v", r, err)
	}
}
func TestHostJoinSigningRejectsTamperedQuote(t *testing.T) {
	for _, mode := range []string{"bytes", "digest", "sender", "budget", "unprepared", "wrong key"} {
		t.Run(mode, func(t *testing.T) {
			q, _ := joinReceiptFixture(t)
			private := ed25519.NewKeyFromSeed(bytes.Repeat([]byte{77}, 32))
			defer clear(private)
			switch mode {
			case "bytes":
				q.TxBytes = "AA=="
			case "digest":
				q.Digest = "other"
			case "sender":
				q.Sender = "other"
			case "budget":
				q.GasBudget++
			case "unprepared":
				q.intent = nil
			case "wrong key":
				private = ed25519.NewKeyFromSeed(bytes.Repeat([]byte{1}, 32))
			}
			if _, err := SignHostJoinQuote(q, private); err == nil {
				t.Fatal("tampered quote reached signing")
			}
		})
	}
}
