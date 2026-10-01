package sui

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net"
	"reflect"
	"testing"

	"github.com/block-vision/sui-go-sdk/models"
	v2 "github.com/block-vision/sui-go-sdk/pb/sui/rpc/v2"
	"google.golang.org/grpc"
	"google.golang.org/protobuf/proto"
)

type transportServer struct {
	v2.UnimplementedLedgerServiceServer
	v2.UnimplementedStateServiceServer
	v2.UnimplementedTransactionExecutionServiceServer
	simulate func(*v2.SimulateTransactionRequest) (*v2.SimulateTransactionResponse, error)
	execute  func(*v2.ExecuteTransactionRequest) (*v2.ExecuteTransactionResponse, error)
	list     func(*v2.ListOwnedObjectsRequest) (*v2.ListOwnedObjectsResponse, error)
}

func (s *transportServer) GetObject(context.Context, *v2.GetObjectRequest) (*v2.GetObjectResponse, error) {
	owner, _ := normalizeAddress("0x2")
	return &v2.GetObjectResponse{Object: &v2.Object{ObjectId: proto.String("0xcoin"), Version: proto.Uint64(7), Digest: proto.String("coin-digest"), Owner: &v2.Owner{Address: proto.String(owner)}}}, nil
}
func (s *transportServer) SimulateTransaction(_ context.Context, r *v2.SimulateTransactionRequest) (*v2.SimulateTransactionResponse, error) {
	return s.simulate(r)
}
func (s *transportServer) ExecuteTransaction(_ context.Context, r *v2.ExecuteTransactionRequest) (*v2.ExecuteTransactionResponse, error) {
	return s.execute(r)
}
func (s *transportServer) ListOwnedObjects(_ context.Context, r *v2.ListOwnedObjectsRequest) (*v2.ListOwnedObjectsResponse, error) {
	return s.list(r)
}

func testTransport(t *testing.T, s *transportServer) *GRPCClient {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	server := grpc.NewServer()
	v2.RegisterLedgerServiceServer(server, s)
	v2.RegisterStateServiceServer(server, s)
	v2.RegisterTransactionExecutionServiceServer(server, s)
	go server.Serve(listener)
	c, err := NewGRPCClient("http://"+listener.Addr().String(), "")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { c.Close(); server.Stop() })
	return c
}

func TestSponsoredMoveCallResolvesThenExecutesBothSignatures(t *testing.T) {
	sender, _ := normalizeAddress("0x1")
	owner, _ := normalizeAddress("0x2")
	s := &transportServer{}
	s.simulate = func(req *v2.SimulateTransactionRequest) (*v2.SimulateTransactionResponse, error) {
		tx := req.Transaction
		if req.GetDoGasSelection() || tx.GetSender() != sender || tx.GetGasPayment().GetOwner() != owner || tx.GetGasPayment().GetObjects()[0].GetVersion() != 7 {
			t.Error("sponsor gas reference/owner was not preserved")
		}
		if !reflect.DeepEqual(req.ReadMask.Paths, []string{"transaction.transaction", "transaction.effects.status"}) {
			t.Error("incorrect simulation response mask")
		}
		ptb := tx.GetKind().GetProgrammableTransaction()
		if ptb.Inputs[0].GetLiteral().GetStringValue() != "18446744073709551615" || len(ptb.Inputs[1].GetLiteral().GetListValue().Values) != 2 {
			t.Error("integer or byte vector argument lost")
		}
		tx = proto.Clone(tx).(*v2.Transaction)
		tx.Bcs = &v2.Bcs{Value: []byte("resolved transaction")}
		return &v2.SimulateTransactionResponse{Transaction: &v2.ExecutedTransaction{Transaction: tx, Effects: &v2.TransactionEffects{Status: &v2.ExecutionStatus{Success: proto.Bool(true)}}}}, nil
	}
	s.execute = func(req *v2.ExecuteTransactionRequest) (*v2.ExecuteTransactionResponse, error) {
		if string(req.Transaction.GetBcs().Value) != "resolved transaction" || len(req.Signatures) != 2 || string(req.Signatures[0].GetBcs().Value) != "sponsor" || string(req.Signatures[1].GetBcs().Value) != "sender" {
			t.Error("execution changed bytes or signatures")
		}
		return &v2.ExecuteTransactionResponse{Transaction: &v2.ExecutedTransaction{Digest: proto.String("digest"), Effects: &v2.TransactionEffects{Status: &v2.ExecutionStatus{Success: proto.Bool(true)}}}}, nil
	}
	c := testTransport(t, s)
	coin := "0xcoin"
	meta, err := c.MoveCall(context.Background(), models.MoveCallRequest{Signer: "0x1", PackageObjectId: "0x3", Module: "test", Function: "call", Gas: &coin, GasBudget: "10000000", Arguments: []any{uint64(18446744073709551615), []byte{1, 255}}})
	if err != nil {
		t.Fatal(err)
	}
	result, err := c.SuiExecuteTransactionBlock(context.Background(), models.SuiExecuteTransactionBlockRequest{TxBytes: meta.TxBytes, Signature: []string{base64.StdEncoding.EncodeToString([]byte("sponsor")), base64.StdEncoding.EncodeToString([]byte("sender"))}})
	if err != nil || result.Digest != "digest" {
		t.Fatalf("execute: %v %+v", err, result)
	}
}

func TestSimulationRefusesModifiedAuthorityOrBudget(t *testing.T) {
	for _, mutation := range []string{"sender", "owner", "budget", "empty-bcs", "failed"} {
		t.Run(mutation, func(t *testing.T) {
			s := &transportServer{simulate: func(req *v2.SimulateTransactionRequest) (*v2.SimulateTransactionResponse, error) {
				tx := proto.Clone(req.Transaction).(*v2.Transaction)
				tx.Bcs = &v2.Bcs{Value: []byte("tx")}
				status := &v2.ExecutionStatus{Success: proto.Bool(true)}
				switch mutation {
				case "sender":
					tx.Sender = proto.String("0xother")
				case "owner":
					tx.GasPayment.Owner = proto.String("0xother")
				case "budget":
					tx.GasPayment.Budget = proto.Uint64(10000001)
				case "empty-bcs":
					tx.Bcs = nil
				case "failed":
					status.Success = proto.Bool(false)
				}
				return &v2.SimulateTransactionResponse{Transaction: &v2.ExecutedTransaction{Transaction: tx, Effects: &v2.TransactionEffects{Status: status}}}, nil
			}}
			c := testTransport(t, s)
			if _, err := c.MoveCall(context.Background(), models.MoveCallRequest{Signer: "0x1", GasBudget: "10000000"}); err == nil {
				t.Fatal("unsafe simulation accepted")
			}
		})
	}
}

func TestExecutionFailureAndOpaqueOwnedObjectPagination(t *testing.T) {
	c := testTransport(t, &transportServer{
		execute: func(*v2.ExecuteTransactionRequest) (*v2.ExecuteTransactionResponse, error) {
			return &v2.ExecuteTransactionResponse{Transaction: &v2.ExecutedTransaction{Digest: proto.String("failed-digest"), Effects: &v2.TransactionEffects{Status: &v2.ExecutionStatus{Success: proto.Bool(false)}}}}, nil
		},
		list: func(req *v2.ListOwnedObjectsRequest) (*v2.ListOwnedObjectsResponse, error) {
			if string(req.PageToken) != "page-2" {
				t.Errorf("page token = %q", req.PageToken)
			}
			return &v2.ListOwnedObjectsResponse{NextPageToken: []byte("page-3"), Objects: []*v2.Object{{ObjectId: proto.String("0xcoin"), Balance: proto.Uint64(18446744073709551615)}}}, nil
		},
	})
	if result, err := c.SuiExecuteTransactionBlock(context.Background(), models.SuiExecuteTransactionBlockRequest{TxBytes: "dHg="}); err == nil || result.Digest != "failed-digest" || result.Effects.Status.Status != "failure" {
		t.Fatalf("confirmed failure must preserve its digest and status: result=%+v err=%v", result, err)
	}
	token := base64.StdEncoding.EncodeToString([]byte("page-2"))
	coins, err := c.SuiXGetCoins(context.Background(), models.SuiXGetCoinsRequest{Owner: "0x1", Cursor: token, Limit: 1})
	if err != nil || !coins.HasNextPage || coins.Data[0].Balance != "18446744073709551615" {
		t.Fatalf("coins: %+v %v", coins, err)
	}
	if _, err := c.SuiXGetOwnedObjects(context.Background(), models.SuiXGetOwnedObjectsRequest{Address: "0x1", Cursor: token, Limit: 1}); err != nil {
		t.Fatal(err)
	}
}

func TestLiteralRejectsUnsafeDoubles(t *testing.T) {
	for _, value := range []any{float64(9007199254740992), 1.5, []any{float64(9007199254740992)}, []float64{9007199254740992}, map[string]float64{"unsafe": 9007199254740992}, json.Number("1e3")} {
		if _, err := literal(value); err == nil {
			t.Fatalf("accepted unsafe argument %v", value)
		}
	}
}

func TestObjectArgumentsRemainDistinctFromAddressPrimitives(t *testing.T) {
	object, err := literal(ObjectArgument("0x6"))
	if err != nil {
		t.Fatal(err)
	}
	address, err := literal("0x6")
	if err != nil {
		t.Fatal(err)
	}
	normalized, _ := normalizeAddress("0x6")
	if object.GetObjectId() != normalized || object.Literal != nil {
		t.Fatal("object reference encoded as a primitive literal")
	}
	if address.ObjectId != nil || address.GetLiteral().GetStringValue() != "0x6" {
		t.Fatal("primitive address inferred as an object reference")
	}
	if _, err := literal(ObjectArgument("invalid")); err == nil {
		t.Fatal("invalid object ID accepted")
	}
}

func TestOfficialGraphQLEndpointInference(t *testing.T) {
	for _, network := range []string{"mainnet", "testnet"} {
		c, err := NewGRPCClient("https://fullnode."+network+".sui.io:443", "")
		if err != nil {
			t.Fatal(err)
		}
		if c.graphqlURL != "https://graphql."+network+".sui.io/graphql" {
			t.Fatal("indexed events would read a different network")
		}
		c.Close()
	}
}

func TestTransferPreservesSelectedGasCoin(t *testing.T) {
	c := testTransport(t, &transportServer{simulate: func(req *v2.SimulateTransactionRequest) (*v2.SimulateTransactionResponse, error) {
		tx := req.Transaction
		if req.GetDoGasSelection() || tx.GasPayment.Objects[0].GetObjectId() != "0xcoin" {
			t.Error("selected gas coin was replaced")
		}
		ptb := tx.Kind.GetProgrammableTransaction()
		if ptb.Commands[0].GetSplitCoins() == nil || ptb.Commands[1].GetTransferObjects() == nil || ptb.Inputs[0].Literal.GetStringValue() != "50000000" || ptb.Commands[1].GetTransferObjects().Objects[0].GetSubresult() != 0 {
			t.Error("transfer PTB is invalid")
		}
		tx = proto.Clone(tx).(*v2.Transaction)
		tx.Bcs = &v2.Bcs{Value: []byte("transfer")}
		return &v2.SimulateTransactionResponse{Transaction: &v2.ExecutedTransaction{Transaction: tx, Effects: &v2.TransactionEffects{Status: &v2.ExecutionStatus{Success: proto.Bool(true)}}}}, nil
	}})
	meta, err := c.TransferSui(context.Background(), models.TransferSuiRequest{Signer: "0x2", SuiObjectId: "0xcoin", Recipient: "0x1", Amount: "50000000", GasBudget: "10000000"})
	if err != nil || meta.TxBytes == "" {
		t.Fatalf("transfer: %+v %v", meta, err)
	}
}
