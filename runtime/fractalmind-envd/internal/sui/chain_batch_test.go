package sui

import (
	"context"
	"errors"
	"fmt"
	"reflect"
	"testing"
	"time"

	v2 "github.com/block-vision/sui-go-sdk/pb/sui/rpc/v2"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/nodecommand"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
)

func batchObject(id string) *v2.GetObjectResult {
	return &v2.GetObjectResult{Result: &v2.GetObjectResult_Object{Object: &v2.Object{ObjectId: proto.String(id), Version: proto.Uint64(7), ObjectType: proto.String("0x3::host::HostMembership"), Owner: &v2.Owner{Kind: v2.Owner_SHARED.Enum()}, Contents: &v2.Bcs{Value: []byte("lossless BCS")}, PreviousTransaction: proto.String("original-transaction")}}}
}

func TestBatchLatestObjectsBoundsRequestsAndRetainsProvenance(t *testing.T) {
	var sizes []int
	s := &transportServer{batch: func(req *v2.BatchGetObjectsRequest) (*v2.BatchGetObjectsResponse, error) {
		sizes = append(sizes, len(req.Requests))
		if !reflect.DeepEqual(req.ReadMask.Paths, chainObjectMask().Paths) {
			t.Fatal("batch dropped provenance fields")
		}
		response := &v2.BatchGetObjectsResponse{}
		for _, r := range req.Requests {
			if r.Version != nil || !reflect.DeepEqual(r.ReadMask.Paths, chainObjectMask().Paths) {
				t.Fatal("batch did not request latest original metadata")
			}
			response.Objects = append(response.Objects, batchObject(r.GetObjectId()))
		}
		return response, nil
	}}
	c := testTransport(t, s)
	ids := make([]string, 33)
	for i := range ids {
		ids[i], _ = normalizeAddress(fmt.Sprintf("0x%x", i+1))
	}
	objects, err := c.ReadChainObjects(context.Background(), ids)
	if err != nil || len(objects) != len(ids) || !reflect.DeepEqual(sizes, []int{32, 1}) {
		t.Fatalf("invalid chunking: %v %v", sizes, err)
	}
	for i, o := range objects {
		if o.ID != ids[i] || !o.Shared || o.Version != 7 || o.PreviousTransaction != "original-transaction" || string(o.Content) != "lossless BCS" {
			t.Fatal("lost exact object metadata")
		}
	}
	if _, err := c.ReadChainObjects(context.Background(), []string{ids[0], ids[0]}); err == nil {
		t.Fatal("duplicate admitted")
	}
	if _, err := c.ReadChainObjects(context.Background(), []string{"0x1"}); err == nil {
		t.Fatal("noncanonical ID admitted")
	}
	if _, err := c.ReadChainObjects(context.Background(), nil); err != nil || len(sizes) != 2 {
		t.Fatal("empty or invalid batch performed an RPC")
	}
}

func TestBatchLatestObjectsRejectsPartialFailureAndWrongMetadata(t *testing.T) {
	first, _ := normalizeAddress("0x1")
	second, _ := normalizeAddress("0x2")
	for _, mutation := range []string{"missing", "reordered", "zero_version", "missing_bcs", "not_found", "unavailable", "empty_result"} {
		t.Run(mutation, func(t *testing.T) {
			s := &transportServer{batch: func(req *v2.BatchGetObjectsRequest) (*v2.BatchGetObjectsResponse, error) {
				objects := []*v2.GetObjectResult{batchObject(first), batchObject(second)}
				switch mutation {
				case "missing":
					objects = objects[:1]
				case "reordered":
					objects[0], objects[1] = objects[1], objects[0]
				case "zero_version":
					objects[1].GetObject().Version = proto.Uint64(0)
				case "missing_bcs":
					objects[1].GetObject().Contents = nil
				case "not_found":
					objects[1] = &v2.GetObjectResult{Result: &v2.GetObjectResult_Error{Error: status.New(codes.NotFound, "absent").Proto()}}
				case "unavailable":
					objects[1] = &v2.GetObjectResult{Result: &v2.GetObjectResult_Error{Error: status.New(codes.Unavailable, "unavailable").Proto()}}
				case "empty_result":
					objects[1] = nil
				}
				return &v2.BatchGetObjectsResponse{Objects: objects}, nil
			}}
			objects, err := testTransport(t, s).ReadChainObjects(context.Background(), []string{first, second})
			if err == nil || objects != nil {
				t.Fatal("partial batch accepted")
			}
			if mutation == "not_found" && !errors.Is(err, nodecommand.ErrChainObjectNotFound) {
				t.Fatal("not-found lost")
			}
			if mutation == "unavailable" && status.Code(err) != codes.Unavailable {
				t.Fatal("unavailable masked")
			}
		})
	}
}

func TestUnaryRPCDeadlineBoundsBackgroundAndPreservesCallerCancellation(t *testing.T) {
	for _, shorter := range []bool{false, true} {
		ctx := context.Background()
		if shorter {
			var cancel context.CancelFunc
			ctx, cancel = context.WithTimeout(ctx, 25*time.Millisecond)
			defer cancel()
		}
		start := time.Now()
		err := boundUnaryRPC(ctx, "read", nil, nil, nil, func(ctx context.Context, _ string, _, _ any, _ *grpc.ClientConn, _ ...grpc.CallOption) error {
			deadline, ok := ctx.Deadline()
			if !ok {
				t.Fatal("background RPC unbounded")
			}
			if !shorter {
				remaining := time.Until(deadline)
				if remaining < 29*time.Second || remaining > 30*time.Second {
					t.Fatal("invalid background deadline")
				}
				return nil
			}
			<-ctx.Done()
			return ctx.Err()
		})
		if shorter && (!errors.Is(err, context.DeadlineExceeded) || time.Since(start) > time.Second) {
			t.Fatalf("caller deadline extended: %v", err)
		}
	}
}
