package nodecommand

import (
	"context"
	"fmt"
	"math"
	"strings"
)

// ChainTime reads Sui Clock for ongoing execution boundaries. Clock is checked
// separately from the authority snapshot: its continuously changing version
// cannot be pinned as an authorization object's version.
func (s *ChainAuthorityResolver) ChainTime(ctx context.Context) (int64, error) {
	id := "0x" + strings.Repeat("0", 63) + "6"
	object, err := s.reader.ReadChainObject(ctx, id)
	if err != nil {
		return 0, err
	}
	if object.ID != id || normalizeMoveType(object.Type) != "0x2::clock::Clock" || !object.Shared || object.Immutable || object.OwnerID != "" || object.Version == 0 {
		return 0, fmt.Errorf("invalid Sui Clock metadata")
	}
	var value struct {
		ID        moveAddress
		Timestamp uint64
	}
	if err := decodeChainBCS(object.Content, &value); err != nil {
		return 0, err
	}
	if value.ID.String() != id || value.Timestamp == 0 || value.Timestamp > math.MaxInt64 {
		return 0, fmt.Errorf("invalid Sui Clock content")
	}
	return int64(value.Timestamp), nil
}
