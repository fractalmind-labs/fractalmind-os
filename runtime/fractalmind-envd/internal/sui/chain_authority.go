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
	response, err := c.ledger.GetObject(ctx, &v2.GetObjectRequest{ObjectId: proto.String(id), ReadMask: &fieldmaskpb.FieldMask{Paths: []string{"object_id", "object_type", "version", "contents", "owner", "previous_transaction"}}})
	if err != nil {
		if status.Code(err) == codes.NotFound {
			return nodecommand.ChainObject{}, nodecommand.ErrChainObjectNotFound
		}
		return nodecommand.ChainObject{}, err
	}
	object := response.GetObject()
	if object == nil || object.GetObjectId() != id || object.GetVersion() == 0 || object.GetObjectType() == "" || len(object.GetContents().GetValue()) == 0 {
		return nodecommand.ChainObject{}, fmt.Errorf("incomplete latest chain object %s", id)
	}
	owner := object.GetOwner()
	return nodecommand.ChainObject{ID: object.GetObjectId(), Type: object.GetObjectType(), Version: object.GetVersion(), PreviousTransaction: object.GetPreviousTransaction(), Shared: owner.GetKind() == v2.Owner_SHARED, Immutable: owner.GetKind() == v2.Owner_IMMUTABLE, OwnerID: owner.GetAddress(), Content: append([]byte(nil), object.GetContents().GetValue()...)}, nil
}
