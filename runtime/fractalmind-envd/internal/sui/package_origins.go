package sui

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/hex"
	"fmt"
	"regexp"

	v2 "github.com/block-vision/sui-go-sdk/pb/sui/rpc/v2"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/fieldmaskpb"
)

// Indexed MovePackage descriptions can lag or omit type origins. The immutable
// ledger Object BCS contains the authoritative table, including types introduced
// in an existing module during an upgrade.
func (c *GRPCClient) ReadChainTypeOrigins(ctx context.Context, id string) (map[string]string, error) {
	canonical, err := normalizeAddress(id)
	if err != nil || canonical != id {
		return nil, fmt.Errorf("package ID must be canonical")
	}
	response, err := c.ledger.GetObject(ctx, &v2.GetObjectRequest{ObjectId: proto.String(id), ReadMask: &fieldmaskpb.FieldMask{Paths: []string{"object_id", "object_type", "version", "owner", "bcs"}}})
	if err != nil {
		return nil, err
	}
	object := response.GetObject()
	if object == nil || object.GetObjectId() != id || object.GetObjectType() != "package" || object.GetVersion() == 0 || object.GetOwner().GetKind() != v2.Owner_IMMUTABLE || object.GetOwner().GetAddress() != "" {
		return nil, fmt.Errorf("unexpected immutable core package")
	}
	return parsePackageOrigins(object.GetBcs().GetValue(), id, object.GetVersion())
}

type packageBCS struct {
	data   []byte
	offset int
}

func (d *packageBCS) take(n int) ([]byte, error) {
	if n < 0 || n > len(d.data)-d.offset {
		return nil, fmt.Errorf("truncated package BCS")
	}
	b := d.data[d.offset : d.offset+n]
	d.offset += n
	return b, nil
}
func (d *packageBCS) length() (int, error) {
	var value uint32
	for i := 0; i < 5; i++ {
		b, err := d.take(1)
		if err != nil {
			return 0, err
		}
		if i == 4 && b[0] > 15 {
			return 0, fmt.Errorf("package BCS length overflow")
		}
		value |= uint32(b[0]&127) << uint(i*7)
		if b[0] < 128 {
			if i > 0 && b[0] == 0 {
				return 0, fmt.Errorf("noncanonical package BCS length")
			}
			if uint64(value) > uint64(len(d.data)-d.offset) {
				return 0, fmt.Errorf("package BCS length exceeds remaining input")
			}
			return int(value), nil
		}
	}
	return 0, fmt.Errorf("invalid package BCS length")
}
func (d *packageBCS) vector() ([]byte, error) {
	n, err := d.length()
	if err != nil {
		return nil, err
	}
	return d.take(n)
}

var packageIdentifier = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)

func parsePackageOrigins(data []byte, id string, version uint64) (map[string]string, error) {
	if len(data) == 0 || len(data) > 1<<20 {
		return nil, fmt.Errorf("invalid immutable package BCS size")
	}
	d := &packageBCS{data: data}
	kind, err := d.take(1)
	if err != nil || kind[0] != 1 {
		return nil, fmt.Errorf("BCS object is not a Move package")
	}
	address, err := d.take(32)
	if err != nil || "0x"+hex.EncodeToString(address) != id {
		return nil, fmt.Errorf("BCS package ID mismatch")
	}
	v, err := d.take(8)
	if err != nil || binary.LittleEndian.Uint64(v) != version {
		return nil, fmt.Errorf("BCS package version mismatch")
	}
	moduleCount, err := d.length()
	if err != nil || moduleCount == 0 {
		return nil, fmt.Errorf("invalid package module map")
	}
	modules := make(map[string]bool, moduleCount)
	for i := 0; i < moduleCount; i++ {
		name, err := d.vector()
		if err != nil || !packageIdentifier.Match(name) || modules[string(name)] {
			return nil, fmt.Errorf("invalid or duplicate package module")
		}
		modules[string(name)] = true
		code, err := d.vector()
		if err != nil || len(code) == 0 {
			return nil, fmt.Errorf("invalid package bytecode")
		}
	}
	count, err := d.length()
	if err != nil {
		return nil, err
	}
	origins := make(map[string]string, count)
	for i := 0; i < count; i++ {
		module, err := d.vector()
		if err != nil || !modules[string(module)] {
			return nil, fmt.Errorf("type origin names an absent module")
		}
		name, err := d.vector()
		if err != nil || !packageIdentifier.Match(name) {
			return nil, fmt.Errorf("invalid type origin datatype")
		}
		key := string(module) + "::" + string(name)
		if _, ok := origins[key]; ok {
			return nil, fmt.Errorf("duplicate package type origin")
		}
		origin, err := d.take(32)
		if err != nil {
			return nil, err
		}
		origins[key] = "0x" + hex.EncodeToString(origin)
	}
	links, err := d.length()
	if err != nil {
		return nil, err
	}
	var previous []byte
	for i := 0; i < links; i++ {
		key, err := d.take(32)
		if err != nil || (i > 0 && bytes.Compare(previous, key) >= 0) {
			return nil, fmt.Errorf("invalid package linkage map")
		}
		previous = key
		if _, err = d.take(32); err != nil {
			return nil, err
		}
		if _, err = d.take(8); err != nil {
			return nil, err
		}
	}
	owner, err := d.take(1)
	if err != nil || owner[0] != 3 {
		return nil, fmt.Errorf("BCS package owner is not immutable")
	}
	digest, err := d.vector()
	if err != nil || len(digest) != 32 {
		return nil, fmt.Errorf("invalid package previous transaction digest")
	}
	if _, err = d.take(8); err != nil {
		return nil, err
	}
	if d.offset != len(data) {
		return nil, fmt.Errorf("trailing immutable package BCS")
	}
	return origins, nil
}
