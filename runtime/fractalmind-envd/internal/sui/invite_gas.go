package sui

import (
	"context"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"fmt"
	"math/big"
	"time"

	v2 "github.com/block-vision/sui-go-sdk/pb/sui/rpc/v2"
	"github.com/block-vision/sui-go-sdk/utils"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/nodecommand"
	"github.com/mr-tron/base58"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/fieldmaskpb"
)

// InviteGasClaimBudget bounds the one transaction that moves invitation Gas
// to the joining Host. The App funds the invitation well above it.
const InviteGasClaimBudget uint64 = 5_000_000

const maxInviteGasCoins = 16

// InviteGasClaim reports the transaction that moved the Gas an invitation
// carried to the joining Host. Status "none" means the invitation held no Gas.
type InviteGasClaim struct {
	Status    string `json:"status"`
	Digest    string `json:"digest,omitempty"`
	Amount    string `json:"amount_mist,omitempty"`
	Recipient string `json:"recipient,omitempty"`
}

type inviteGasCoin struct {
	id      [32]byte
	version uint64
	digest  []byte
	balance uint64
}

// ClaimInviteGas moves every SUI coin owned by the invitation key to the Host
// in one self-paid transaction: TransferObjects([GasCoin], host). The bytes are
// built locally with explicit Gas objects, simulated, and signed only after the
// simulation succeeds. An invitation that holds no Gas returns Status "none".
func (c *GRPCClient) ClaimInviteGas(ctx context.Context, chain string, invite *nodecommand.HostInvitation, recipient string) (InviteGasClaim, error) {
	var claim InviteGasClaim
	if invite == nil || invite.Address() == "" {
		return claim, fmt.Errorf("invalid Host invitation")
	}
	to, err := normalizeAddress(recipient)
	if err != nil || to != recipient {
		return claim, fmt.Errorf("invalid Host address for invitation Gas")
	}
	if err = c.CheckHostJoinChain(ctx, chain); err != nil {
		return claim, err
	}
	ctx, cancel := context.WithTimeout(ctx, 45*time.Second)
	defer cancel()
	sender := invite.Address()
	coins, total, err := c.inviteGasCoins(ctx, sender)
	if err != nil {
		return claim, err
	}
	if len(coins) == 0 {
		return InviteGasClaim{Status: "none"}, nil
	}
	if total <= InviteGasClaimBudget {
		return claim, fmt.Errorf("invitation Gas %d MIST does not cover the transfer budget", total)
	}
	info, err := c.ledger.GetServiceInfo(ctx, &v2.GetServiceInfoRequest{})
	if err != nil {
		return claim, err
	}
	epoch, err := c.ledger.GetEpoch(ctx, &v2.GetEpochRequest{Epoch: proto.Uint64(info.GetEpoch()), ReadMask: &fieldmaskpb.FieldMask{Paths: []string{"epoch", "reference_gas_price"}}})
	if err != nil {
		return claim, err
	}
	price := epoch.GetEpoch().GetReferenceGasPrice()
	if price == 0 {
		return claim, fmt.Errorf("missing reference Gas price")
	}
	raw, err := encodeInviteGasClaim(sender, recipient, coins, price, InviteGasClaimBudget)
	if err != nil {
		return claim, err
	}
	digest, err := utils.GetTxDigestFromBytes(raw)
	if err != nil {
		return claim, err
	}
	tx := &v2.Transaction{Bcs: &v2.Bcs{Value: raw}}
	simulated, err := c.execution.SimulateTransaction(ctx, &v2.SimulateTransactionRequest{Transaction: tx, DoGasSelection: proto.Bool(false), ReadMask: &fieldmaskpb.FieldMask{Paths: []string{"transaction.effects.status", "transaction.effects.gas_used"}}})
	if err != nil {
		return claim, err
	}
	if err = executionError(simulated.GetTransaction()); err != nil {
		return claim, err
	}
	signature, err := invite.SignSuiTransaction(raw)
	if err != nil {
		return claim, err
	}
	sig, _ := base64.StdEncoding.DecodeString(signature)
	response, err := c.execution.ExecuteTransaction(ctx, &v2.ExecuteTransactionRequest{Transaction: tx, Signatures: []*v2.UserSignature{{Bcs: &v2.Bcs{Value: sig}}}, ReadMask: &fieldmaskpb.FieldMask{Paths: []string{"digest", "effects.status", "effects.gas_used"}}})
	if err != nil {
		return InviteGasClaim{Status: "unknown", Digest: digest, Recipient: recipient}, err
	}
	executed := response.GetTransaction()
	if executed.GetDigest() != digest {
		return InviteGasClaim{Status: "unknown", Digest: digest, Recipient: recipient}, fmt.Errorf("invitation Gas receipt does not match its transaction")
	}
	if err = executionError(executed); err != nil {
		return InviteGasClaim{Status: "failed", Digest: digest, Recipient: recipient}, err
	}
	fee, err := joinNetFee(executed.GetEffects().GetGasUsed())
	if err != nil {
		return InviteGasClaim{Status: "confirmed", Digest: digest, Recipient: recipient}, nil
	}
	amount := new(big.Int).SetUint64(total)
	if spent, ok := new(big.Int).SetString(fee, 10); ok {
		amount.Sub(amount, spent)
	}
	return InviteGasClaim{Status: "confirmed", Digest: digest, Amount: amount.String(), Recipient: recipient}, nil
}

func (c *GRPCClient) inviteGasCoins(ctx context.Context, owner string) ([]inviteGasCoin, uint64, error) {
	response, err := c.state.ListOwnedObjects(ctx, &v2.ListOwnedObjectsRequest{Owner: proto.String(owner), ObjectType: proto.String("0x2::coin::Coin<0x2::sui::SUI>"), PageSize: proto.Uint32(maxInviteGasCoins), ReadMask: &fieldmaskpb.FieldMask{Paths: []string{"object_id", "version", "digest", "balance", "owner"}}})
	if err != nil {
		return nil, 0, err
	}
	var coins []inviteGasCoin
	var total uint64
	for _, object := range response.GetObjects() {
		if object.GetOwner().GetKind() != v2.Owner_ADDRESS || object.GetOwner().GetAddress() != owner {
			return nil, 0, fmt.Errorf("invitation Gas coin has an unexpected owner")
		}
		id, err := normalizeAddress(object.GetObjectId())
		if err != nil {
			return nil, 0, err
		}
		rawID, _ := hex.DecodeString(id[2:])
		digest, err := base58.Decode(object.GetDigest())
		if err != nil || len(digest) != 32 || object.GetVersion() == 0 {
			return nil, 0, fmt.Errorf("invalid invitation Gas coin reference")
		}
		coin := inviteGasCoin{version: object.GetVersion(), digest: digest, balance: object.GetBalance()}
		copy(coin.id[:], rawID)
		if total+coin.balance < total {
			return nil, 0, fmt.Errorf("invitation Gas balance overflow")
		}
		total += coin.balance
		coins = append(coins, coin)
	}
	return coins, total, nil
}

// encodeInviteGasClaim builds TransactionData::V1 for a programmable transaction
// with one pure address input and TransferObjects([GasCoin], Input(0)). The Gas
// payment lists every invitation coin explicitly, so the whole balance moves.
func encodeInviteGasClaim(sender, recipient string, coins []inviteGasCoin, price, budget uint64) ([]byte, error) {
	from, err := normalizeAddress(sender)
	if err != nil || from != sender {
		return nil, fmt.Errorf("invalid invitation address")
	}
	to, err := normalizeAddress(recipient)
	if err != nil || to != recipient {
		return nil, fmt.Errorf("invalid Host address")
	}
	if len(coins) == 0 || len(coins) > maxInviteGasCoins || price == 0 || budget == 0 {
		return nil, fmt.Errorf("invalid invitation Gas payment")
	}
	senderRaw, _ := hex.DecodeString(from[2:])
	recipientRaw, _ := hex.DecodeString(to[2:])
	data := []byte{0, 0}                     // TransactionData::V1, TransactionKind::ProgrammableTransaction
	data = append(data, 1, 0, 32)            // one input: CallArg::Pure(vector<u8> of 32 bytes)
	data = append(data, recipientRaw...)     // the Host address
	data = append(data, 1, 1, 1, 0, 1, 0, 0) // one command: TransferObjects([GasCoin], Input(0))
	data = append(data, senderRaw...)        // sender: the invitation key
	data = append(data, byte(len(coins)))    // Gas payment object references
	for _, coin := range coins {
		data = append(data, coin.id[:]...)
		data = binary.LittleEndian.AppendUint64(data, coin.version)
		data = append(data, 32)
		data = append(data, coin.digest...)
	}
	data = append(data, senderRaw...) // Gas owner: the invitation key pays its own transfer
	data = binary.LittleEndian.AppendUint64(data, price)
	data = binary.LittleEndian.AppendUint64(data, budget)
	return append(data, 0), nil // TransactionExpiration::None
}
