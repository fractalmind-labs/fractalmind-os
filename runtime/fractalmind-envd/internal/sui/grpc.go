package sui

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"net/url"
	"reflect"
	"strconv"
	"strings"
	"time"

	"github.com/block-vision/sui-go-sdk/models"
	v2 "github.com/block-vision/sui-go-sdk/pb/sui/rpc/v2"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/fieldmaskpb"
	"google.golang.org/protobuf/types/known/structpb"
)

// GRPCClient keeps the existing domain request types while replacing their
// transport. It never sends JSON-RPC. Move calls are resolved by gRPC simulation
// into BCS before signing; indexed event history is read from GraphQL.
type GRPCClient struct {
	conn       *grpc.ClientConn
	ledger     v2.LedgerServiceClient
	state      v2.StateServiceClient
	execution  v2.TransactionExecutionServiceClient
	graphqlURL string
	http       *http.Client
}

func NewGRPCClient(endpoint, graphqlURL string) (*GRPCClient, error) {
	if !strings.Contains(endpoint, "://") {
		endpoint = "https://" + endpoint
	}
	u, err := url.Parse(endpoint)
	if err != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") || (u.Path != "" && u.Path != "/") || u.RawQuery != "" || u.User != nil {
		return nil, fmt.Errorf("invalid Sui gRPC endpoint %q: use an http(s) fullnode host", endpoint)
	}
	var transport credentials.TransportCredentials = credentials.NewTLS(&tls.Config{MinVersion: tls.VersionTLS12})
	if u.Scheme == "http" {
		transport = insecure.NewCredentials()
	}
	target := u.Host
	if u.Port() == "" {
		if u.Scheme == "https" {
			target += ":443"
		} else {
			target += ":80"
		}
	}
	if graphqlURL == "" {
		switch u.Hostname() {
		case "fullnode.testnet.sui.io":
			graphqlURL = "https://graphql.testnet.sui.io/graphql"
		case "fullnode.mainnet.sui.io":
			graphqlURL = "https://graphql.mainnet.sui.io/graphql"
		}
	}
	conn, err := grpc.NewClient(target, grpc.WithTransportCredentials(transport), grpc.WithDefaultCallOptions(grpc.MaxCallRecvMsgSize(16<<20)))
	if err != nil {
		return nil, err
	}
	return &GRPCClient{conn: conn, ledger: v2.NewLedgerServiceClient(conn), state: v2.NewStateServiceClient(conn), execution: v2.NewTransactionExecutionServiceClient(conn), graphqlURL: graphqlURL, http: &http.Client{Timeout: 30 * time.Second}}, nil
}

func (c *GRPCClient) Close() error { return c.conn.Close() }

func inputArgument(index uint32) *v2.Argument {
	return &v2.Argument{Kind: v2.Argument_INPUT.Enum(), Input: proto.Uint32(index)}
}

// ObjectArgument explicitly distinguishes a Move object reference from an
// address/string primitive. Never guess from a string's 0x prefix.
type ObjectArgument string

// ChunkedBytes assembles a bounded vector inside the same PTB; each pure
// argument remains below Sui's 16 KiB limit. No staging object is persisted.
type ChunkedBytes []byte

// The payload helper remains in core when the called product module is in an extension.
type PackageChunkedBytes struct {
	PackageID string
	Bytes     []byte
}

func appendMoveArgument(ptb *v2.ProgrammableTransaction, packageID string, arg any) (*v2.Argument, error) {
	if data, ok := arg.(PackageChunkedBytes); ok {
		core, err := normalizeAddress(data.PackageID)
		if err != nil {
			return nil, err
		}
		return appendMoveArgument(ptb, core, ChunkedBytes(data.Bytes))
	}
	if data, ok := arg.(ChunkedBytes); ok {
		if len(data) > 65536 {
			return nil, fmt.Errorf("byte payload exceeds 64 KiB")
		}
		const chunkSize = 16000
		first := len(data)
		if first > chunkSize {
			first = chunkSize
		}
		value, err := appendMoveArgument(ptb, packageID, []byte(data[:first]))
		if err != nil {
			return nil, err
		}
		for start := chunkSize; start < len(data); start += chunkSize {
			end := start + chunkSize
			if end > len(data) {
				end = len(data)
			}
			next, err := appendMoveArgument(ptb, packageID, []byte(data[start:end]))
			if err != nil {
				return nil, err
			}
			index := uint32(len(ptb.Commands))
			ptb.Commands = append(ptb.Commands, &v2.Command{Command: &v2.Command_MoveCall{MoveCall: &v2.MoveCall{Package: proto.String(packageID), Module: proto.String("wire_bytes"), Function: proto.String("append_bytes"), Arguments: []*v2.Argument{value, next}}}})
			value = &v2.Argument{Kind: v2.Argument_RESULT.Enum(), Result: proto.Uint32(index)}
		}
		return value, nil
	}
	in, err := literal(arg)
	if err != nil {
		return nil, err
	}
	index := uint32(len(ptb.Inputs))
	ptb.Inputs = append(ptb.Inputs, in)
	return inputArgument(index), nil
}

// literal preserves decimal integer strings rather than coercing u64 into an
// imprecise protobuf double. Slice/map inputs are normalized through JSON.
func literal(value any) (*v2.Input, error) {
	if object, ok := value.(ObjectArgument); ok {
		id, err := normalizeAddress(string(object))
		if err != nil {
			return nil, err
		}
		return &v2.Input{ObjectId: proto.String(id)}, nil
	}
	if b, ok := value.([]byte); ok {
		value = byteVector(b)
	}
	data, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	if err := validateNumbers(value); err != nil {
		return nil, err
	}
	var normalized any
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.UseNumber()
	if err := decoder.Decode(&normalized); err != nil {
		return nil, err
	}
	normalized, err = normalizeNumbers(normalized)
	if err != nil {
		return nil, err
	}
	v, err := structpb.NewValue(normalized)
	if err != nil {
		return nil, err
	}
	return &v2.Input{Literal: v}, nil
}

// JSON integers are strings in protobuf literals, because NumberValue is a
// double. Sui resolves decimal strings according to the Move parameter type.
func validateNumbers(value any) error {
	return validateNumericValue(reflect.ValueOf(value))
}

func validateNumericValue(value reflect.Value) error {
	if !value.IsValid() {
		return nil
	}
	switch value.Kind() {
	case reflect.Interface, reflect.Pointer:
		if !value.IsNil() {
			return validateNumericValue(value.Elem())
		}
	case reflect.Float32, reflect.Float64:
		number := value.Float()
		limit := float64(9007199254740991)
		if value.Kind() == reflect.Float32 {
			limit = 16777215
		}
		if math.Abs(number) > limit || math.Trunc(number) != number {
			return fmt.Errorf("unsafe numeric Move argument; send an integer decimal string")
		}
	case reflect.Slice, reflect.Array:
		for i := 0; i < value.Len(); i++ {
			if err := validateNumericValue(value.Index(i)); err != nil {
				return err
			}
		}
	case reflect.Map:
		for iter := value.MapRange(); iter.Next(); {
			if err := validateNumericValue(iter.Value()); err != nil {
				return err
			}
		}
	case reflect.Struct:
		for i := 0; i < value.NumField(); i++ {
			if value.Type().Field(i).IsExported() {
				if err := validateNumericValue(value.Field(i)); err != nil {
					return err
				}
			}
		}
	}
	return nil
}

func normalizeNumbers(value any) (any, error) {
	switch v := value.(type) {
	case json.Number:
		if strings.ContainsAny(v.String(), ".eE") {
			return nil, fmt.Errorf("Move integer arguments must be exact decimal integers")
		}
		return v.String(), nil
	case []any:
		for i, item := range v {
			converted, err := normalizeNumbers(item)
			if err != nil {
				return nil, err
			}
			v[i] = converted
		}
		return v, nil
	case map[string]any:
		for key, item := range v {
			converted, err := normalizeNumbers(item)
			if err != nil {
				return nil, err
			}
			v[key] = converted
		}
		return v, nil
	default:
		return value, nil
	}
}

func normalizeAddress(address string) (string, error) {
	raw := strings.TrimPrefix(address, "0x")
	if len(raw) == 0 || len(raw) > 64 {
		return "", fmt.Errorf("invalid Sui address %q", address)
	}
	raw = strings.Repeat("0", 64-len(raw)) + raw
	if _, err := hex.DecodeString(raw); err != nil {
		return "", fmt.Errorf("invalid Sui address %q", address)
	}
	return "0x" + strings.ToLower(raw), nil
}

func pageToken(cursor any) ([]byte, error) {
	if cursor == nil {
		return nil, nil
	}
	token, ok := cursor.(string)
	if !ok {
		return nil, fmt.Errorf("gRPC pagination cursor must be a base64 string")
	}
	if token == "" {
		return nil, nil
	}
	return base64.StdEncoding.DecodeString(token)
}

func (c *GRPCClient) MoveCall(ctx context.Context, req models.MoveCallRequest) (models.TxnMetaData, error) {
	sender, err := normalizeAddress(req.Signer)
	if err != nil {
		return models.TxnMetaData{}, err
	}
	budget, err := strconv.ParseUint(req.GasBudget, 10, 64)
	if err != nil || budget == 0 {
		return models.TxnMetaData{}, fmt.Errorf("invalid gas budget %q", req.GasBudget)
	}
	ptb := &v2.ProgrammableTransaction{}
	call := &v2.MoveCall{Package: proto.String(req.PackageObjectId), Module: proto.String(req.Module), Function: proto.String(req.Function)}
	for _, arg := range req.TypeArguments {
		s, ok := arg.(string)
		if !ok {
			return models.TxnMetaData{}, fmt.Errorf("type argument must be a string")
		}
		call.TypeArguments = append(call.TypeArguments, s)
	}
	for i, arg := range req.Arguments {
		argument, err := appendMoveArgument(ptb, req.PackageObjectId, arg)
		if err != nil {
			return models.TxnMetaData{}, fmt.Errorf("argument %d: %w", i, err)
		}
		call.Arguments = append(call.Arguments, argument)
	}
	ptb.Commands = append(ptb.Commands, &v2.Command{Command: &v2.Command_MoveCall{MoveCall: call}})
	tx := &v2.Transaction{Version: proto.Int32(1), Sender: proto.String(sender), Kind: &v2.TransactionKind{Kind: v2.TransactionKind_PROGRAMMABLE_TRANSACTION.Enum(), Data: &v2.TransactionKind_ProgrammableTransaction{ProgrammableTransaction: ptb}}, GasPayment: &v2.GasPayment{Owner: proto.String(sender), Budget: proto.Uint64(budget)}}
	if req.Gas != nil {
		if err := c.setGasCoin(ctx, tx, *req.Gas); err != nil {
			return models.TxnMetaData{}, err
		}
	}

	return c.resolve(ctx, tx, budget)
}

// Resolve a selected gas object explicitly so sponsor ownership and coin
// versions survive transaction construction.
func (c *GRPCClient) setGasCoin(ctx context.Context, tx *v2.Transaction, coinID string) error {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	res, err := c.ledger.GetObject(ctx, &v2.GetObjectRequest{ObjectId: proto.String(coinID), ReadMask: &fieldmaskpb.FieldMask{Paths: []string{"object_id", "version", "digest", "owner"}}})
	if err != nil {
		return err
	}
	obj := res.GetObject()
	owner, err := normalizeAddress(obj.GetOwner().GetAddress())
	if err != nil || obj.GetObjectId() == "" || obj.GetVersion() == 0 || obj.GetDigest() == "" {
		return fmt.Errorf("gas coin has an incomplete reference or no address owner")
	}
	tx.GasPayment.Owner = proto.String(owner)
	tx.GasPayment.Objects = []*v2.ObjectReference{{ObjectId: obj.ObjectId, Version: obj.Version, Digest: obj.Digest}}
	return nil
}

func (c *GRPCClient) resolve(ctx context.Context, tx *v2.Transaction, budget uint64) (models.TxnMetaData, error) {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	resp, err := c.execution.SimulateTransaction(ctx, &v2.SimulateTransactionRequest{Transaction: tx, DoGasSelection: proto.Bool(len(tx.GetGasPayment().GetObjects()) == 0), ReadMask: &fieldmaskpb.FieldMask{Paths: []string{"transaction.transaction", "transaction.effects.status"}}})
	if err != nil {
		return models.TxnMetaData{}, err
	}
	if err := executionError(resp.GetTransaction()); err != nil {
		return models.TxnMetaData{}, err
	}
	resolved := resp.GetTransaction().GetTransaction()
	if resolved.GetSender() != tx.GetSender() || resolved.GetGasPayment().GetOwner() != tx.GetGasPayment().GetOwner() || resolved.GetGasPayment().GetBudget() == 0 || resolved.GetGasPayment().GetBudget() > budget {
		return models.TxnMetaData{}, fmt.Errorf("simulation changed sender, gas owner or exceeded gas budget")
	}
	if len(resolved.GetBcs().GetValue()) == 0 {
		return models.TxnMetaData{}, fmt.Errorf("simulation returned no transaction BCS")
	}
	return models.TxnMetaData{TxBytes: base64.StdEncoding.EncodeToString(resolved.GetBcs().GetValue())}, nil
}

func executionError(tx *v2.ExecutedTransaction) error {
	status := tx.GetEffects().GetStatus()
	if status == nil {
		return fmt.Errorf("Sui response is missing execution status")
	}
	if !status.GetSuccess() {
		return fmt.Errorf("Sui transaction failed: %s", status.GetError().String())
	}
	return nil
}

func (c *GRPCClient) SignAndExecuteTransactionBlock(ctx context.Context, req models.SignAndExecuteTransactionBlockRequest) (models.SuiTransactionBlockResponse, error) {
	signed := req.TxnMetaData.SignSerializedSigWith(req.PriKey)
	return c.SuiExecuteTransactionBlock(ctx, models.SuiExecuteTransactionBlockRequest{TxBytes: signed.TxBytes, Signature: []string{signed.Signature}, Options: req.Options})
}

func (c *GRPCClient) SuiExecuteTransactionBlock(ctx context.Context, req models.SuiExecuteTransactionBlockRequest) (models.SuiTransactionBlockResponse, error) {
	bytes, err := base64.StdEncoding.DecodeString(req.TxBytes)
	if err != nil {
		return models.SuiTransactionBlockResponse{}, err
	}
	signatures := make([]*v2.UserSignature, 0, len(req.Signature))
	for _, signature := range req.Signature {
		sig, err := base64.StdEncoding.DecodeString(signature)
		if err != nil {
			return models.SuiTransactionBlockResponse{}, err
		}
		signatures = append(signatures, &v2.UserSignature{Bcs: &v2.Bcs{Value: sig}})
	}
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	resp, err := c.execution.ExecuteTransaction(ctx, &v2.ExecuteTransactionRequest{Transaction: &v2.Transaction{Bcs: &v2.Bcs{Value: bytes}}, Signatures: signatures, ReadMask: &fieldmaskpb.FieldMask{Paths: []string{"digest", "effects.status"}}})
	if err != nil {
		return models.SuiTransactionBlockResponse{}, err
	}
	if err := executionError(resp.GetTransaction()); err != nil {
		result := models.SuiTransactionBlockResponse{Digest: resp.GetTransaction().GetDigest()}
		if status := resp.GetTransaction().GetEffects().GetStatus(); status != nil && !status.GetSuccess() {
			result.Effects.Status.Status = "failure"
		}
		return result, err
	}
	return models.SuiTransactionBlockResponse{Digest: resp.GetTransaction().GetDigest(), Effects: models.SuiEffects{Status: models.ExecutionStatus{Status: "success"}}}, nil
}

func (c *GRPCClient) SuiXGetOwnedObjects(ctx context.Context, req models.SuiXGetOwnedObjectsRequest) (models.PaginatedObjectsResponse, error) {
	token, err := pageToken(req.Cursor)
	if err != nil {
		return models.PaginatedObjectsResponse{}, err
	}
	filter, err := json.Marshal(req.Query.Filter)
	if err != nil {
		return models.PaginatedObjectsResponse{}, err
	}
	var typeFilter struct {
		Type string `json:"StructType"`
	}
	if err := json.Unmarshal(filter, &typeFilter); err != nil {
		return models.PaginatedObjectsResponse{}, err
	}
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	resp, err := c.state.ListOwnedObjects(ctx, &v2.ListOwnedObjectsRequest{PageToken: token, Owner: proto.String(req.Address), ObjectType: proto.String(typeFilter.Type), PageSize: proto.Uint32(uint32(req.Limit)), ReadMask: &fieldmaskpb.FieldMask{Paths: []string{"object_id", "object_type"}}})
	if err != nil {
		return models.PaginatedObjectsResponse{}, err
	}
	result := models.PaginatedObjectsResponse{HasNextPage: len(resp.NextPageToken) > 0, NextCursor: base64.StdEncoding.EncodeToString(resp.NextPageToken)}
	for _, obj := range resp.Objects {
		result.Data = append(result.Data, models.SuiObjectResponse{Data: &models.SuiObjectData{ObjectId: obj.GetObjectId(), Type: obj.GetObjectType()}})
	}
	return result, nil
}

func (c *GRPCClient) SuiXGetCoins(ctx context.Context, req models.SuiXGetCoinsRequest) (models.PaginatedCoinsResponse, error) {
	token, err := pageToken(req.Cursor)
	if err != nil {
		return models.PaginatedCoinsResponse{}, err
	}
	coinType := req.CoinType
	if coinType == "" {
		coinType = "0x2::sui::SUI"
	}
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	resp, err := c.state.ListOwnedObjects(ctx, &v2.ListOwnedObjectsRequest{PageToken: token, Owner: proto.String(req.Owner), ObjectType: proto.String("0x2::coin::Coin<" + coinType + ">"), PageSize: proto.Uint32(uint32(req.Limit)), ReadMask: &fieldmaskpb.FieldMask{Paths: []string{"object_id", "version", "digest", "balance"}}})
	if err != nil {
		return models.PaginatedCoinsResponse{}, err
	}
	result := models.PaginatedCoinsResponse{HasNextPage: len(resp.NextPageToken) > 0, NextCursor: base64.StdEncoding.EncodeToString(resp.NextPageToken)}
	for _, obj := range resp.Objects {
		result.Data = append(result.Data, models.CoinData{CoinObjectId: obj.GetObjectId(), Version: strconv.FormatUint(obj.GetVersion(), 10), Digest: obj.GetDigest(), Balance: strconv.FormatUint(obj.GetBalance(), 10), CoinType: coinType})
	}
	return result, nil
}

func (c *GRPCClient) TransferSui(ctx context.Context, req models.TransferSuiRequest) (models.TxnMetaData, error) {
	amount, err := literal(req.Amount)
	if err != nil {
		return models.TxnMetaData{}, err
	}
	recipient, err := literal(req.Recipient)
	if err != nil {
		return models.TxnMetaData{}, err
	}
	sender, err := normalizeAddress(req.Signer)
	if err != nil {
		return models.TxnMetaData{}, err
	}
	budget, err := strconv.ParseUint(req.GasBudget, 10, 64)
	if err != nil || budget == 0 {
		return models.TxnMetaData{}, fmt.Errorf("invalid gas budget %q", req.GasBudget)
	}
	ptb := &v2.ProgrammableTransaction{Inputs: []*v2.Input{amount, recipient}, Commands: []*v2.Command{
		{Command: &v2.Command_SplitCoins{SplitCoins: &v2.SplitCoins{Coin: &v2.Argument{Kind: v2.Argument_GAS.Enum()}, Amounts: []*v2.Argument{inputArgument(0)}}}},
		{Command: &v2.Command_TransferObjects{TransferObjects: &v2.TransferObjects{Objects: []*v2.Argument{{Kind: v2.Argument_RESULT.Enum(), Result: proto.Uint32(0), Subresult: proto.Uint32(0)}}, Address: inputArgument(1)}}},
	}}
	tx := &v2.Transaction{Version: proto.Int32(1), Sender: proto.String(sender), Kind: &v2.TransactionKind{Kind: v2.TransactionKind_PROGRAMMABLE_TRANSACTION.Enum(), Data: &v2.TransactionKind_ProgrammableTransaction{ProgrammableTransaction: ptb}}, GasPayment: &v2.GasPayment{Owner: proto.String(sender), Budget: proto.Uint64(budget)}}
	if req.SuiObjectId != "" {
		if err := c.setGasCoin(ctx, tx, req.SuiObjectId); err != nil {
			return models.TxnMetaData{}, err
		}
		if tx.GetGasPayment().GetOwner() != sender {
			return models.TxnMetaData{}, fmt.Errorf("transfer gas coin must be owned by the sender")
		}
	}
	return c.resolve(ctx, tx, budget)
}
