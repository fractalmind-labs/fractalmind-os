package sui

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"fmt"
	"time"

	v2 "github.com/block-vision/sui-go-sdk/pb/sui/rpc/v2"
	"github.com/block-vision/sui-go-sdk/utils"
	"github.com/mr-tron/base58"
	"golang.org/x/crypto/blake2b"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/fieldmaskpb"
)

type HostJoinReceiptRequest struct {
	Digest, Sender      string
	GasBudget, GasPrice uint64
}
type HostJoinWrite struct {
	ID      string `json:"id"`
	Version uint64 `json:"version"`
}
type HostJoinReceipt struct {
	Digest    string          `json:"digest"`
	Status    string          `json:"status"`
	ActualFee string          `json:"actual_fee_mist"`
	Writes    []HostJoinWrite `json:"-"`
}

func (c *GRPCClient) CheckHostJoinChain(ctx context.Context, chain string) error {
	id, err := base58.Decode(chain)
	if err != nil || len(id) != 32 || base58.Encode(id) != chain {
		return fmt.Errorf("pinned Sui chain identifier required")
	}
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	info, err := c.ledger.GetServiceInfo(ctx, &v2.GetServiceInfoRequest{})
	if err != nil {
		return err
	}
	if info.GetChainId() != chain {
		return fmt.Errorf("Host join RPC is on a different chain")
	}
	return nil
}

// QueryHostJoin consults only the original digest, not invitation authority or
// a membership inference. Unavailable/pruned or incomplete receipts stay unknown.
func (c *GRPCClient) QueryHostJoin(ctx context.Context, req HostJoinReceiptRequest) (HostJoinReceipt, error) {
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	response, err := c.ledger.GetTransaction(ctx, &v2.GetTransactionRequest{Digest: proto.String(req.Digest), ReadMask: &fieldmaskpb.FieldMask{Paths: hostJoinReceiptMask}})
	if err != nil {
		return HostJoinReceipt{}, err
	}
	return parseHostJoinReceipt(response.GetTransaction(), req)
}

var hostJoinReceiptMask = []string{"digest", "transaction.bcs", "transaction.sender", "transaction.gas_payment", "effects.status", "effects.gas_used", "effects.transaction_digest", "effects.changed_objects"}

func parseHostJoinReceipt(tx *v2.ExecutedTransaction, req HostJoinReceiptRequest) (HostJoinReceipt, error) {
	var result HostJoinReceipt
	digest, err := utils.GetTxDigestFromBytes(tx.GetTransaction().GetBcs().GetValue())
	if err != nil || digest != req.Digest || tx.GetDigest() != req.Digest || tx.GetEffects().GetTransactionDigest() != req.Digest || tx.GetTransaction().GetSender() != req.Sender || tx.GetTransaction().GetGasPayment().GetOwner() != req.Sender || tx.GetTransaction().GetGasPayment().GetBudget() != req.GasBudget || tx.GetTransaction().GetGasPayment().GetPrice() != req.GasPrice || tx.GetEffects().GetStatus() == nil {
		return result, fmt.Errorf("original Host join receipt is incomplete or does not match")
	}
	fee, err := joinNetFee(tx.GetEffects().GetGasUsed())
	if err != nil {
		return result, err
	}
	result = HostJoinReceipt{Digest: req.Digest, Status: "failed", ActualFee: fee}
	if tx.GetEffects().GetStatus().GetSuccess() {
		result.Status = "confirmed"
	}
	for _, write := range tx.GetEffects().GetChangedObjects() {
		if write.GetOutputState() == v2.ChangedObject_OUTPUT_OBJECT_STATE_OBJECT_WRITE {
			id, e := normalizeAddress(write.GetObjectId())
			if e != nil || id != write.GetObjectId() || write.GetOutputVersion() == 0 {
				return HostJoinReceipt{}, fmt.Errorf("original receipt has invalid output versions")
			}
			result.Writes = append(result.Writes, HostJoinWrite{ID: id, Version: write.GetOutputVersion()})
		}
	}
	return result, nil
}

func (q HostJoinQuote) checkedBytes() ([]byte, error) {
	if q.intent == nil {
		return nil, fmt.Errorf("unprepared Host join quote")
	}
	raw, err := base64.StdEncoding.DecodeString(q.TxBytes)
	if err != nil {
		return nil, err
	}
	verified, err := validateHostJoinBCS(raw, *q.intent)
	if err != nil || verified.Digest != q.Digest || verified.Sender != q.Sender || verified.GasBudget != q.GasBudget || verified.GasPrice != q.GasPrice {
		return nil, fmt.Errorf("Host join quote changed before signing")
	}
	return raw, nil
}

// SignHostJoinQuote uses only the Host's OS-loaded Ed25519 key. It neither
// broadcasts nor persists the signed bytes or bearer invitation.
func SignHostJoinQuote(q HostJoinQuote, private ed25519.PrivateKey) (string, error) {
	if len(private) != 64 || signingAddressForJoin(private[32:]) != q.Sender {
		return "", fmt.Errorf("Host signing key mismatch")
	}
	raw, err := q.checkedBytes()
	if err != nil {
		return "", err
	}
	hash := blake2b.Sum256(append([]byte{0, 0, 0}, raw...))
	signature := append([]byte{0}, ed25519.Sign(private, hash[:])...)
	signature = append(signature, private[32:]...)
	return base64.StdEncoding.EncodeToString(signature), nil
}

// RevalidateHostJoinQuote simulates the exact original bytes after confirmation
// with Gas selection disabled. A changed/expired input requires a new preview.
func (c *GRPCClient) RevalidateHostJoinQuote(ctx context.Context, q HostJoinQuote) error {
	raw, err := q.checkedBytes()
	if err != nil {
		return err
	}
	if err = c.CheckHostJoinChain(ctx, q.intent.request.ChainIdentifier); err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	response, err := c.execution.SimulateTransaction(ctx, &v2.SimulateTransactionRequest{Transaction: &v2.Transaction{Bcs: &v2.Bcs{Value: raw}}, DoGasSelection: proto.Bool(false), ReadMask: &fieldmaskpb.FieldMask{Paths: []string{"transaction.transaction", "transaction.effects.status"}}})
	if err != nil {
		return err
	}
	if err = executionError(response.GetTransaction()); err != nil {
		return err
	}
	if !bytes.Equal(response.GetTransaction().GetTransaction().GetBcs().GetValue(), raw) {
		return fmt.Errorf("revalidation changed the original Host join transaction")
	}
	return nil
}
func (c *GRPCClient) ExecuteHostJoin(ctx context.Context, q HostJoinQuote, signature string) (HostJoinReceipt, error) {
	raw, err := q.checkedBytes()
	if err != nil {
		return HostJoinReceipt{}, err
	}
	sig, err := base64.StdEncoding.DecodeString(signature)
	if err != nil || len(sig) != 97 || sig[0] != 0 || signingAddressForJoin(sig[65:]) != q.Sender {
		return HostJoinReceipt{}, fmt.Errorf("invalid Host join signature")
	}
	hash := blake2b.Sum256(append([]byte{0, 0, 0}, raw...))
	if !ed25519.Verify(ed25519.PublicKey(sig[65:]), hash[:], sig[1:65]) {
		return HostJoinReceipt{}, fmt.Errorf("Host join signature does not match quote")
	}
	if q.broadcast == nil || !q.broadcast.CompareAndSwap(false, true) {
		return HostJoinReceipt{}, fmt.Errorf("Host join quote already submitted; query original digest")
	}
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	response, err := c.execution.ExecuteTransaction(ctx, &v2.ExecuteTransactionRequest{Transaction: &v2.Transaction{Bcs: &v2.Bcs{Value: raw}}, Signatures: []*v2.UserSignature{{Bcs: &v2.Bcs{Value: sig}}}, ReadMask: &fieldmaskpb.FieldMask{Paths: hostJoinReceiptMask}})
	if err != nil {
		return HostJoinReceipt{}, err
	}
	return parseHostJoinReceipt(response.GetTransaction(), HostJoinReceiptRequest{Digest: q.Digest, Sender: q.Sender, GasBudget: q.GasBudget, GasPrice: q.GasPrice})
}
