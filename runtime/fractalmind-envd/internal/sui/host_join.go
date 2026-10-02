package sui

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"fmt"
	"math/big"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/block-vision/sui-go-sdk/mystenbcs"
	v2 "github.com/block-vision/sui-go-sdk/pb/sui/rpc/v2"
	"github.com/block-vision/sui-go-sdk/utils"
	"github.com/mr-tron/base58"
	"golang.org/x/crypto/blake2b"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/fieldmaskpb"
)

// HostJoinRequest contains the intent confirmed by the Host operator. Invitation
// entropy is never passed to the RPC; ProofSignature authorizes this Host only.
type HostJoinRequest struct {
	PackageID, Sender, OrganizationID, InviteID, BindingID, IssuerHuman, IssuerGrant string
	ChainIdentifier                                                                  string
	HostPublicKey, EncryptionPublicKey, ProofSignature                               []byte
	Name                                                                             string
	ProofExpiresAtMS, GasBudget                                                      uint64
}

type HostJoinQuote struct {
	TxBytes         string `json:"-"`
	Digest          string `json:"digest"`
	Sender          string `json:"sender"`
	GasBudget       uint64 `json:"gas_budget_mist"`
	GasPrice        uint64 `json:"gas_price_mist"`
	EstimatedNetFee string `json:"estimated_net_fee_mist"`
	gas             []joinGas
}
type joinGas struct {
	id, digest string
	version    uint64
}

type joinObject struct {
	id      string
	version uint64
	mutable bool
}
type joinIntent struct {
	request    HostJoinRequest
	objects    map[int]joinObject
	pure       map[int][]byte
	expiration []byte
}

func signingAddressForJoin(public []byte) string {
	sum := blake2b.Sum256(append([]byte{0}, public...))
	return "0x" + hex.EncodeToString(sum[:])
}

func newJoinIntent(req HostJoinRequest) (joinIntent, error) {
	i := joinIntent{request: req, objects: map[int]joinObject{}, pure: map[int][]byte{}}
	for _, id := range []string{req.PackageID, req.Sender, req.OrganizationID, req.InviteID, req.BindingID, req.IssuerHuman, req.IssuerGrant} {
		canonical, err := normalizeAddress(id)
		if err != nil || canonical != id {
			return i, fmt.Errorf("canonical Host join addresses required")
		}
	}
	if len(req.HostPublicKey) != 32 || len(req.EncryptionPublicKey) != 32 || len(req.ProofSignature) != 64 || len(req.Name) == 0 || len(req.Name) > 128 || !utf8.ValidString(req.Name) || req.ProofExpiresAtMS == 0 || req.GasBudget == 0 {
		return i, fmt.Errorf("invalid Host join parameters")
	}
	// Bind the transaction sender to the local Host signing public key.
	if signingAddressForJoin(req.HostPublicKey) != req.Sender {
		return i, fmt.Errorf("Host signing key does not match sender")
	}
	clock, _ := normalizeAddress("0x6")
	ids := map[int]string{0: req.OrganizationID, 1: req.InviteID, 2: req.BindingID, 3: req.IssuerHuman, 4: req.IssuerGrant, 10: clock}
	for index, id := range ids {
		i.objects[index] = joinObject{id: id, mutable: index < 2}
	}
	values := map[int]any{5: req.HostPublicKey, 6: req.EncryptionPublicKey, 7: req.Name, 8: req.ProofExpiresAtMS, 9: req.ProofSignature}
	for index, value := range values {
		data, err := mystenbcs.Marshal(value)
		if err != nil {
			return i, err
		}
		i.pure[index] = data
	}
	return i, nil
}

// PrepareHostJoin signs nothing. It builds pure inputs locally, resolves only
// object references/Gas through gRPC and checks the actual BCS, independent of
// the server's protobuf projection, before exposing bytes to the signer.
func (c *GRPCClient) PrepareHostJoin(ctx context.Context, req HostJoinRequest) (HostJoinQuote, error) {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	var quote HostJoinQuote
	i, err := newJoinIntent(req)
	if err != nil {
		return quote, err
	}
	chain, err := base58.Decode(req.ChainIdentifier)
	if err != nil || len(chain) != 32 || base58.Encode(chain) != req.ChainIdentifier {
		return quote, fmt.Errorf("pinned Sui chain identifier required")
	}
	info, err := c.ledger.GetServiceInfo(ctx, &v2.GetServiceInfoRequest{})
	if err != nil {
		return quote, err
	}
	if info.GetChainId() != req.ChainIdentifier || info.Epoch == nil || info.GetEpoch() == ^uint64(0) {
		return quote, fmt.Errorf("Host join chain identifier/epoch mismatch")
	}
	epoch, err := c.ledger.GetEpoch(ctx, &v2.GetEpochRequest{Epoch: proto.Uint64(info.GetEpoch()), ReadMask: &fieldmaskpb.FieldMask{Paths: []string{"epoch", "reference_gas_price"}}})
	if err != nil {
		return quote, err
	}
	price := epoch.GetEpoch().GetReferenceGasPrice()
	if price == 0 || epoch.GetEpoch().Epoch == nil || epoch.GetEpoch().GetEpoch() != info.GetEpoch() {
		return quote, fmt.Errorf("missing reference Gas price")
	}
	nonce := make([]byte, 4)
	if _, err = rand.Read(nonce); err != nil {
		return quote, err
	}
	// ValidDuring protects address-balance payments against replay. Construct it
	// locally even though the pinned Go protobuf predates this enum variant.
	i.expiration = []byte{2, 1}
	i.expiration = binary.LittleEndian.AppendUint64(i.expiration, info.GetEpoch())
	i.expiration = append(i.expiration, 1)
	i.expiration = binary.LittleEndian.AppendUint64(i.expiration, info.GetEpoch()+1)
	// Match the current SDK's epoch-only ValidDuring. Timestamp bounds are not
	// yet enabled by all validators; the Move JoinIntent enforces proof expiry.
	i.expiration = append(i.expiration, 0, 0)
	i.expiration = append(i.expiration, 32)
	i.expiration = append(i.expiration, chain...)
	i.expiration = append(i.expiration, nonce...)
	for index := 0; index < 11; index++ {
		if object, ok := i.objects[index]; ok {
			result, readErr := c.ledger.GetObject(ctx, &v2.GetObjectRequest{ObjectId: proto.String(object.id), ReadMask: &fieldmaskpb.FieldMask{Paths: []string{"object_id", "owner"}}})
			if readErr != nil {
				return quote, readErr
			}
			o := result.GetObject()
			if o.GetObjectId() != object.id || o.GetOwner().GetKind() != v2.Owner_SHARED || o.GetOwner().GetVersion() == 0 {
				return quote, fmt.Errorf("Host join requires a current shared object")
			}
			object.version = o.GetOwner().GetVersion()
			i.objects[index] = object
		}
	}
	// Send the locally built BCS so a legacy protobuf cannot silently drop the
	// replay-protection fields. The server may select Gas, never alter the intent.
	raw := encodeHostJoinIntent(i, price, req.GasBudget)
	tx := &v2.Transaction{Bcs: &v2.Bcs{Value: raw}}
	response, err := c.execution.SimulateTransaction(ctx, &v2.SimulateTransactionRequest{Transaction: tx, DoGasSelection: proto.Bool(true), ReadMask: &fieldmaskpb.FieldMask{Paths: []string{"transaction.transaction", "transaction.effects.status", "transaction.effects.gas_used"}}})
	if err != nil {
		return quote, err
	}
	if err = executionError(response.GetTransaction()); err != nil {
		return quote, err
	}
	resolved := response.GetTransaction().GetTransaction()
	quote, err = validateHostJoinBCS(resolved.GetBcs().GetValue(), i)
	if err != nil {
		return HostJoinQuote{}, err
	}
	// Both views must agree. Neither can substitute a different sender or budget.
	if resolved.GetSender() != quote.Sender || resolved.GetGasPayment().GetOwner() != quote.Sender || resolved.GetGasPayment().GetBudget() != quote.GasBudget || resolved.GetGasPayment().GetPrice() != quote.GasPrice {
		return HostJoinQuote{}, fmt.Errorf("Host join BCS/projection disagree")
	}
	if quote.GasPrice != price || len(resolved.GetGasPayment().GetObjects()) != len(quote.gas) {
		return HostJoinQuote{}, fmt.Errorf("simulation changed Host join Gas references or price")
	}
	for index, gas := range quote.gas {
		ref := resolved.GetGasPayment().GetObjects()[index]
		if ref.GetObjectId() != gas.id || ref.GetVersion() != gas.version || ref.GetDigest() != gas.digest {
			return HostJoinQuote{}, fmt.Errorf("Gas reference BCS/projection disagree")
		}
		result, readErr := c.ledger.GetObject(ctx, &v2.GetObjectRequest{ObjectId: proto.String(gas.id), ReadMask: &fieldmaskpb.FieldMask{Paths: []string{"object_id", "version", "digest", "owner", "object_type"}}})
		if readErr != nil {
			return HostJoinQuote{}, readErr
		}
		object := result.GetObject()
		expectedType := "0x2::coin::Coin<0x2::sui::SUI>"
		actualType := object.GetObjectType()
		fullTwo, _ := normalizeAddress("0x2")
		actualType = strings.ReplaceAll(actualType, fullTwo, "0x2")
		if object.GetObjectId() != gas.id || object.GetVersion() != gas.version || object.GetDigest() != gas.digest || object.GetOwner().GetKind() != v2.Owner_ADDRESS || object.GetOwner().GetAddress() != req.Sender || actualType != expectedType {
			return HostJoinQuote{}, fmt.Errorf("Host join Gas is stale, foreign or not SUI")
		}
	}
	quote.EstimatedNetFee, err = joinNetFee(response.GetTransaction().GetEffects().GetGasUsed())
	if err != nil {
		return HostJoinQuote{}, err
	}
	return quote, nil
}

func joinNetFee(gas *v2.GasCostSummary) (string, error) {
	if gas == nil || gas.ComputationCost == nil || gas.StorageCost == nil || gas.StorageRebate == nil {
		return "", fmt.Errorf("missing Host join Gas summary")
	}
	amount := new(big.Int).SetUint64(gas.GetComputationCost())
	amount.Add(amount, new(big.Int).SetUint64(gas.GetStorageCost()))
	amount.Sub(amount, new(big.Int).SetUint64(gas.GetStorageRebate()))
	return amount.String(), nil
}

// This bounded reader supports the exact single-call PTB we construct. It does
// not decode arbitrary enums into reflection-based allocations, accept trailing
// bytes, or follow untrusted vector lengths. Unsupported transaction forms fail.
type joinBCS struct {
	data   []byte
	offset int
	err    error
}

func (r *joinBCS) take(n int) []byte {
	if r.err != nil {
		return nil
	}
	if n < 0 || n > len(r.data)-r.offset {
		r.err = fmt.Errorf("truncated Host join BCS")
		return nil
	}
	p := r.data[r.offset : r.offset+n]
	r.offset += n
	return p
}
func (r *joinBCS) uint64() uint64 {
	p := r.take(8)
	if len(p) != 8 {
		return 0
	}
	return binary.LittleEndian.Uint64(p)
}
func (r *joinBCS) expect(p []byte) {
	if !bytes.Equal(r.take(len(p)), p) && r.err == nil {
		r.err = fmt.Errorf("Host join BCS changed confirmed intent")
	}
}
func (r *joinBCS) length(max uint32) int {
	var n uint32
	for shift := uint(0); shift <= 28; shift += 7 {
		b := r.take(1)
		if len(b) != 1 {
			return 0
		}
		v := b[0]
		if shift == 28 && v > 15 {
			r.err = fmt.Errorf("BCS length overflow")
			return 0
		}
		n |= uint32(v&127) << shift
		if v&128 == 0 {
			if (shift > 0 && v == 0) || n > max {
				r.err = fmt.Errorf("noncanonical or oversized BCS length")
				return 0
			}
			return int(n)
		}
	}
	r.err = fmt.Errorf("invalid BCS length")
	return 0
}
func (r *joinBCS) address(id string) {
	p, err := hex.DecodeString(id[2:])
	if err != nil {
		r.err = err
		return
	}
	r.expect(p)
}
func (r *joinBCS) text(s string) { n := r.length(128); r.expectLength(n, len(s)); r.expect([]byte(s)) }
func (r *joinBCS) expectLength(a, b int) {
	if a != b && r.err == nil {
		r.err = fmt.Errorf("Host join BCS has an unexpected length")
	}
}

func validateHostJoinBCS(raw []byte, i joinIntent) (HostJoinQuote, error) {
	var q HostJoinQuote
	if len(raw) == 0 || len(raw) > 16384 {
		return q, fmt.Errorf("invalid Host join BCS size")
	}
	r := &joinBCS{data: raw}
	r.expect([]byte{0, 0}) // TransactionData::V1 / ProgrammableTransaction
	r.expectLength(r.length(11), 11)
	for index := 0; index < 11; index++ {
		if object, ok := i.objects[index]; ok {
			r.expect([]byte{1, 1}) // CallArg::Object / ObjectArg::SharedObject
			r.address(object.id)
			if r.uint64() != object.version && r.err == nil {
				r.err = fmt.Errorf("shared object version changed")
			}
			mutable := byte(0)
			if object.mutable {
				mutable = 1
			}
			r.expect([]byte{mutable})
		} else {
			r.expect([]byte{0})
			pure := i.pure[index]
			r.expectLength(r.length(256), len(pure))
			r.expect(pure)
		}
	}
	r.expectLength(r.length(1), 1)
	r.expect([]byte{0})
	r.address(i.request.PackageID)
	r.text("host")
	r.text("redeem_invite")
	r.expectLength(r.length(0), 0) // no type arguments
	r.expectLength(r.length(11), 11)
	for index := 0; index < 11; index++ {
		r.expect([]byte{1, byte(index), 0})
	} // Argument::Input(u16)
	r.address(i.request.Sender)
	gasCount := r.length(32)
	seen := map[string]bool{}
	for n := 0; n < gasCount; n++ {
		id := r.take(32)
		if len(id) == 32 && bytes.Equal(id, make([]byte, 32)) {
			r.err = fmt.Errorf("invalid Gas object")
		}
		version := r.uint64()
		if version == 0 && r.err == nil {
			r.err = fmt.Errorf("invalid Gas version")
		}
		r.expectLength(r.length(32), 32)
		digest := r.take(32)
		idString := "0x" + hex.EncodeToString(id)
		if seen[idString] {
			r.err = fmt.Errorf("duplicate Gas object")
		}
		seen[idString] = true
		q.gas = append(q.gas, joinGas{id: idString, version: version, digest: base58.Encode(digest)})
	}
	r.address(i.request.Sender)
	price, budget := r.uint64(), r.uint64()
	if price == 0 || budget == 0 || budget > i.request.GasBudget {
		r.err = fmt.Errorf("invalid self-paid Host join Gas bounds")
	}
	if len(i.expiration) == 0 {
		r.err = fmt.Errorf("Host join replay-protection is missing")
	} else {
		r.expect(i.expiration)
	}
	if r.err != nil {
		return q, r.err
	}
	if r.offset != len(raw) {
		return q, fmt.Errorf("Host join BCS contains trailing bytes")
	}
	digest, err := utils.GetTxDigestFromBytes(raw)
	if err != nil {
		return q, err
	}
	q.TxBytes = base64.StdEncoding.EncodeToString(raw)
	q.Digest = digest
	q.Sender = i.request.Sender
	q.GasBudget = budget
	q.GasPrice = price
	return q, nil
}

func encodeHostJoinIntent(i joinIntent, price, budget uint64) []byte {
	data := []byte{0, 0, 11}
	address := func(id string) { raw, _ := hex.DecodeString(id[2:]); data = append(data, raw...) }
	vector := func(raw []byte) {
		n := uint32(len(raw))
		for n >= 128 {
			data = append(data, byte(n)|128)
			n >>= 7
		}
		data = append(data, byte(n))
		data = append(data, raw...)
	}
	for index := 0; index < 11; index++ {
		if object, ok := i.objects[index]; ok {
			data = append(data, 1, 1)
			address(object.id)
			data = binary.LittleEndian.AppendUint64(data, object.version)
			mutable := byte(0)
			if object.mutable {
				mutable = 1
			}
			data = append(data, mutable)
		} else {
			data = append(data, 0)
			vector(i.pure[index])
		}
	}
	data = append(data, 1, 0)
	address(i.request.PackageID)
	vector([]byte("host"))
	vector([]byte("redeem_invite"))
	data = append(data, 0, 11)
	for index := 0; index < 11; index++ {
		data = append(data, 1, byte(index), 0)
	}
	address(i.request.Sender)
	data = append(data, 0)
	address(i.request.Sender)
	data = binary.LittleEndian.AppendUint64(data, price)
	data = binary.LittleEndian.AppendUint64(data, budget)
	return append(data, i.expiration...)
}
