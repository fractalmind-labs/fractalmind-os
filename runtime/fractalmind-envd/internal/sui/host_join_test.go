package sui

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"os"
	"testing"

	v2 "github.com/block-vision/sui-go-sdk/pb/sui/rpc/v2"
	"google.golang.org/protobuf/proto"
)

type joinGolden struct {
	Request       HostJoinRequest
	TxBytes       string
	Digest        string
	SharedVersion uint64
	Expiration    string
	CoinTxBytes   string
	CoinDigest    string
	Coin          struct{ ObjectID, Version, Digest string }
}

func readJoinGolden(t *testing.T) (joinGolden, joinIntent, []byte) {
	t.Helper()
	var g joinGolden
	data, err := os.ReadFile("testdata/host_join_mysten.json")
	if err != nil {
		t.Fatal(err)
	}
	if err = json.Unmarshal(data, &g); err != nil {
		t.Fatal(err)
	}
	i, err := newJoinIntent(g.Request)
	if err != nil {
		t.Fatal(err)
	}
	for index, object := range i.objects {
		object.version = g.SharedVersion
		i.objects[index] = object
	}
	i.expiration, err = base64.StdEncoding.DecodeString(g.Expiration)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := base64.StdEncoding.DecodeString(g.TxBytes)
	if err != nil {
		t.Fatal(err)
	}
	return g, i, raw
}
func TestHostJoinBCSMatchesIndependentMystenSDK(t *testing.T) {
	g, i, raw := readJoinGolden(t)
	q, err := validateHostJoinBCS(raw, i)
	if err != nil {
		t.Fatal(err)
	}
	if q.Digest != g.Digest || q.Sender != g.Request.Sender || q.GasBudget != 10000000 || q.GasPrice != 1000 {
		t.Fatalf("wrong SDK transaction projection %+v", q)
	}
	if built := encodeHostJoinIntent(i, 1000, 10000000); !bytes.Equal(built, raw) {
		t.Fatal("Go transaction differs from independent SDK BCS")
	}
}
func TestHostJoinBCSRejectsRPCSubstitution(t *testing.T) {
	for _, mode := range []string{"package", "sender", "organization", "invite", "binding", "issuer", "key", "encryption", "name", "proof expiry", "proof signature", "shared version", "mutable", "argument order", "extra input", "extra command", "type argument", "sponsor", "gas budget", "gas price", "expiration", "unknown enum", "trailing", "noncanonical count"} {
		t.Run(mode, func(t *testing.T) {
			_, i, raw := readJoinGolden(t)
			changed := append([]byte(nil), raw...)
			mutateID := func(id *string) { canonical, _ := normalizeAddress("0x99"); *id = canonical }
			switch mode {
			case "package":
				mutateID(&i.request.PackageID)
			case "sender":
				mutateID(&i.request.Sender)
			case "organization", "invite", "binding", "issuer":
				index := map[string]int{"organization": 0, "invite": 1, "binding": 2, "issuer": 3}[mode]
				o := i.objects[index]
				mutateID(&o.id)
				i.objects[index] = o
			case "key", "encryption", "name", "proof expiry", "proof signature":
				index := map[string]int{"key": 5, "encryption": 6, "name": 7, "proof expiry": 8, "proof signature": 9}[mode]
				i.pure[index][len(i.pure[index])-1] ^= 1
			case "shared version":
				o := i.objects[0]
				o.version++
				i.objects[0] = o
			case "mutable":
				o := i.objects[2]
				o.mutable = true
				i.objects[2] = o
			case "argument order":
				pattern := []byte{11, 1, 0, 0, 1, 1, 0, 1, 2, 0}
				offset := bytes.Index(changed, pattern)
				if offset < 0 {
					t.Fatal("arguments missing")
				}
				changed[offset+2] = 1
			case "extra input":
				changed[2] = 12
			case "extra command":
				offset := bytes.Index(changed, []byte("redeem_invite")) - 40
				changed[offset] = 2
			case "type argument":
				offset := bytes.Index(changed, []byte("redeem_invite")) + len("redeem_invite")
				changed[offset] = 1
			case "sponsor":
				changed[len(changed)-len(i.expiration)-48] ^= 1
			case "gas budget":
				changed[len(changed)-len(i.expiration)-8] = 255
				changed[len(changed)-len(i.expiration)-1] = 255
			case "gas price":
				for n := len(changed) - len(i.expiration) - 16; n < len(changed)-len(i.expiration)-8; n++ {
					changed[n] = 0
				}
			case "expiration":
				changed[len(changed)-1] ^= 1
			case "unknown enum":
				changed[0] = 255
			case "trailing":
				changed = append(changed, 0)
			case "noncanonical count":
				changed = append(append([]byte{}, changed[:2]...), append([]byte{139, 0}, changed[3:]...)...)
			}
			if _, err := validateHostJoinBCS(changed, i); err == nil {
				t.Fatal("modified RPC BCS reached signer")
			}
		})
	}
}
func TestHostJoinBCSTruncationAndAllocationBounds(t *testing.T) {
	_, i, raw := readJoinGolden(t)
	for n := 0; n < len(raw); n++ {
		if _, err := validateHostJoinBCS(raw[:n], i); err == nil {
			t.Fatalf("truncated frame %d accepted", n)
		}
	}
	for _, bad := range [][]byte{{0, 0, 255, 255, 255, 255, 15}, {0, 0, 255, 255, 255, 255, 16}, make([]byte, 16385)} {
		if _, err := validateHostJoinBCS(bad, i); err == nil {
			t.Fatal("oversized frame accepted")
		}
	}
}
func TestHostJoinFeesUseSignedRebateAndRequireSummary(t *testing.T) {
	fee, err := joinNetFee(&v2.GasCostSummary{ComputationCost: proto.Uint64(1), StorageCost: proto.Uint64(2), StorageRebate: proto.Uint64(10), NonRefundableStorageFee: proto.Uint64(999)})
	if err != nil || fee != "-7" {
		t.Fatalf("rebate double counted or negative discarded: %s %v", fee, err)
	}
	if _, err = joinNetFee(&v2.GasCostSummary{}); err == nil {
		t.Fatal("missing Gas accepted")
	}
}

// Injected gRPC fixture verifies the production preparation path without
// representing a real validator or OS credential store.
type hostJoinTransport struct {
	*transportServer
	chain     string
	mutation  string
	simulated bool
	gas       *v2.Object
}

func (s *hostJoinTransport) GetServiceInfo(context.Context, *v2.GetServiceInfoRequest) (*v2.GetServiceInfoResponse, error) {
	return &v2.GetServiceInfoResponse{ChainId: proto.String(s.chain), Epoch: proto.Uint64(42)}, nil
}
func (s *hostJoinTransport) GetEpoch(context.Context, *v2.GetEpochRequest) (*v2.GetEpochResponse, error) {
	return &v2.GetEpochResponse{Epoch: &v2.Epoch{Epoch: proto.Uint64(42), ReferenceGasPrice: proto.Uint64(1000)}}, nil
}
func (s *hostJoinTransport) GetObject(_ context.Context, r *v2.GetObjectRequest) (*v2.GetObjectResponse, error) {
	if s.gas != nil && r.GetObjectId() == s.gas.GetObjectId() {
		return &v2.GetObjectResponse{Object: proto.Clone(s.gas).(*v2.Object)}, nil
	}
	return &v2.GetObjectResponse{Object: &v2.Object{ObjectId: r.ObjectId, Owner: &v2.Owner{Kind: v2.Owner_SHARED.Enum(), Version: proto.Uint64(11)}}}, nil
}

func TestHostJoinPreparationChecksRawTransactionAndProjection(t *testing.T) {
	for _, mode := range []string{"valid", "wrong chain", "changed raw name", "changed projection", "missing fee", "coin", "foreign coin", "stale coin", "not SUI coin", "coin projection"} {
		t.Run(mode, func(t *testing.T) {
			g, i, raw := readJoinGolden(t)
			s := &hostJoinTransport{transportServer: &transportServer{}, chain: g.Request.ChainIdentifier}
			coinMode := mode == "coin" || mode == "foreign coin" || mode == "stale coin" || mode == "not SUI coin" || mode == "coin projection"
			if coinMode {
				var err error
				raw, err = base64.StdEncoding.DecodeString(g.CoinTxBytes)
				if err != nil {
					t.Fatal(err)
				}
				s.gas = &v2.Object{ObjectId: proto.String(g.Coin.ObjectID), Version: proto.Uint64(12), Digest: proto.String(g.Coin.Digest), ObjectType: proto.String("0x2::coin::Coin<0x2::sui::SUI>"), Owner: &v2.Owner{Kind: v2.Owner_ADDRESS.Enum(), Address: proto.String(g.Request.Sender)}}
				if mode == "foreign coin" {
					s.gas.Owner.Address = proto.String("another Host")
				}
				if mode == "stale coin" {
					s.gas.Version = proto.Uint64(13)
				}
				if mode == "not SUI coin" {
					s.gas.ObjectType = proto.String("0x2::coin::Coin<0x99::custom::Token>")
				}
			}
			if mode == "wrong chain" {
				s.chain = "other chain"
			}
			s.simulate = func(req *v2.SimulateTransactionRequest) (*v2.SimulateTransactionResponse, error) {
				s.simulated = true
				if !req.GetDoGasSelection() || req.Transaction.Bcs == nil {
					t.Fatal("simulation discarded locally constructed BCS")
				}
				input := req.Transaction.GetBcs().GetValue()
				i.expiration = append([]byte(nil), input[len(input)-len(i.expiration):]...)
				if _, err := validateHostJoinBCS(input, i); err != nil {
					t.Fatal(err)
				}
				// Match the fresh nonce while keeping an independently serialized PTB.
				resolvedRaw := append([]byte(nil), raw...)
				copy(resolvedRaw[len(resolvedRaw)-len(i.expiration):], i.expiration)
				if mode == "changed raw name" {
					offset := bytes.Index(resolvedRaw, []byte("fixture-host"))
					resolvedRaw[offset] ^= 1
				}
				resolved := &v2.Transaction{Bcs: &v2.Bcs{Value: resolvedRaw}, Sender: proto.String(g.Request.Sender), GasPayment: &v2.GasPayment{Owner: proto.String(g.Request.Sender), Price: proto.Uint64(1000), Budget: proto.Uint64(g.Request.GasBudget)}}
				if coinMode {
					resolved.GasPayment.Objects = []*v2.ObjectReference{{ObjectId: proto.String(g.Coin.ObjectID), Version: proto.Uint64(12), Digest: proto.String(g.Coin.Digest)}}
					if mode == "coin projection" {
						resolved.GasPayment.Objects[0].Version = proto.Uint64(13)
					}
				}
				if mode == "changed projection" {
					resolved.GasPayment.Owner = proto.String("different sender")
				}
				gas := &v2.GasCostSummary{ComputationCost: proto.Uint64(5), StorageCost: proto.Uint64(10), StorageRebate: proto.Uint64(1)}
				if mode == "missing fee" {
					gas = nil
				}
				return &v2.SimulateTransactionResponse{Transaction: &v2.ExecutedTransaction{Transaction: resolved, Effects: &v2.TransactionEffects{Status: &v2.ExecutionStatus{Success: proto.Bool(true)}, GasUsed: gas}}}, nil
			}
			c := testTransport(t, s)
			q, err := c.PrepareHostJoin(context.Background(), g.Request)
			if mode == "valid" || mode == "coin" {
				if err != nil || q.TxBytes == "" || q.EstimatedNetFee != "14" {
					t.Fatalf("valid preparation failed %+v %v", q, err)
				}
			} else {
				if err == nil || q.TxBytes != "" {
					t.Fatal("unsafe quote returned signable bytes")
				}
			}
			if mode == "wrong chain" && s.simulated {
				t.Fatal("wrong chain reached simulation")
			}
		})
	}
}
