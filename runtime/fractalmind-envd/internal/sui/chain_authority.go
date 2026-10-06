package sui

import (
	"context"
	"fmt"

	v2 "github.com/block-vision/sui-go-sdk/pb/sui/rpc/v2"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/nodecommand"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/fieldmaskpb"
)

// ReadChainObject reads latest ledger state via native gRPC. It requests raw
// Move contents so u64s never pass through float JSON or a local projection.
func (c *GRPCClient) ReadChainObject(ctx context.Context, id string) (nodecommand.ChainObject, error) {
	canonical, err := normalizeAddress(id)
	if err != nil || canonical != id {
		return nodecommand.ChainObject{}, fmt.Errorf("object ID must be canonical")
	}
	response, err := c.ledger.GetObject(ctx, &v2.GetObjectRequest{ObjectId: proto.String(id), ReadMask: chainObjectMask()})
	if err != nil {
		if status.Code(err) == codes.NotFound {
			return nodecommand.ChainObject{}, nodecommand.ErrChainObjectNotFound
		}
		return nodecommand.ChainObject{}, err
	}
	return decodeChainObject(response.GetObject(), id)
}

func chainObjectMask() *fieldmaskpb.FieldMask {
	return &fieldmaskpb.FieldMask{Paths: []string{"object_id", "object_type", "version", "contents", "owner", "previous_transaction"}}
}

func decodeChainObject(object *v2.Object, id string) (nodecommand.ChainObject, error) {
	if object == nil || object.GetObjectId() != id || object.GetVersion() == 0 || object.GetObjectType() == "" || len(object.GetContents().GetValue()) == 0 {
		return nodecommand.ChainObject{}, fmt.Errorf("incomplete latest chain object %s", id)
	}
	owner := object.GetOwner()
	return nodecommand.ChainObject{ID: object.GetObjectId(), Type: object.GetObjectType(), Version: object.GetVersion(), PreviousTransaction: object.GetPreviousTransaction(), Shared: owner.GetKind() == v2.Owner_SHARED, Immutable: owner.GetKind() == v2.Owner_IMMUTABLE, OwnerID: owner.GetAddress(), Content: append([]byte(nil), object.GetContents().GetValue()...)}, nil
}

// Latest dependency rechecks use native gRPC batches to avoid a network round
// trip per object. A missing, failed, reordered or incomplete item rejects the
// whole snapshot. There is no fallback to old values or another transport.
func (c *GRPCClient) ReadChainObjects(ctx context.Context, ids []string) ([]nodecommand.ChainObject, error) {
	seen := make(map[string]bool, len(ids))
	for _, id := range ids {
		canonical, err := normalizeAddress(id)
		if err != nil || canonical != id || seen[id] {
			return nil, fmt.Errorf("batch object IDs must be canonical and unique")
		}
		seen[id] = true
	}
	const batchLimit = 32
	objects := make([]nodecommand.ChainObject, 0, len(ids))
	for offset := 0; offset < len(ids); offset += batchLimit {
		end := min(offset+batchLimit, len(ids))
		requests := make([]*v2.GetObjectRequest, 0, end-offset)
		for _, id := range ids[offset:end] {
			requests = append(requests, &v2.GetObjectRequest{ObjectId: proto.String(id), ReadMask: chainObjectMask()})
		}
		response, err := c.ledger.BatchGetObjects(ctx, &v2.BatchGetObjectsRequest{Requests: requests, ReadMask: chainObjectMask()})
		if err != nil {
			return nil, err
		}
		if len(response.GetObjects()) != len(requests) {
			return nil, fmt.Errorf("incomplete latest chain object batch")
		}
		for i, result := range response.GetObjects() {
			if result.GetError() != nil {
				err := status.FromProto(result.GetError()).Err()
				if status.Code(err) == codes.NotFound {
					return nil, nodecommand.ErrChainObjectNotFound
				}
				if err == nil {
					err = fmt.Errorf("object batch returned an invalid success error")
				}
				return nil, err
			}
			object, err := decodeChainObject(result.GetObject(), ids[offset+i])
			if err != nil {
				return nil, err
			}
			objects = append(objects, object)
		}
	}
	return objects, nil
}
