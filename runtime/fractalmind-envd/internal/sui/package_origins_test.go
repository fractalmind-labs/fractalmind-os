package sui

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"os"
	"reflect"
	"testing"

	v2 "github.com/block-vision/sui-go-sdk/pb/sui/rpc/v2"
	"google.golang.org/protobuf/proto"
)

func originPackageFixture(t *testing.T) (string, uint64, []byte, []byte, map[string]string) {
	t.Helper()
	data, err := os.ReadFile("testdata/mixed-type-origins.json")
	if err != nil {
		t.Fatal(err)
	}
	var input struct {
		ID                                  string
		Version                             uint64
		ObjectBcsBase64, DuplicateBcsBase64 string
		Expected                            map[string]string
	}
	if err = json.Unmarshal(data, &input); err != nil {
		t.Fatal(err)
	}
	valid, err := base64.StdEncoding.DecodeString(input.ObjectBcsBase64)
	if err != nil {
		t.Fatal(err)
	}
	duplicate, err := base64.StdEncoding.DecodeString(input.DuplicateBcsBase64)
	if err != nil {
		t.Fatal(err)
	}
	return input.ID, input.Version, valid, duplicate, input.Expected
}

func TestPackageOriginsUseImmutableRawBCSNotIndexedDescription(t *testing.T) {
	id, version, data, _, expected := originPackageFixture(t)
	c := testTransport(t, &transportServer{object: func(request *v2.GetObjectRequest) (*v2.GetObjectResponse, error) {
		if request.GetObjectId() != id || !reflect.DeepEqual(request.ReadMask.Paths, []string{"object_id", "object_type", "version", "owner", "bcs"}) {
			t.Fatal("exact immutable package not requested")
		}
		return &v2.GetObjectResponse{Object: &v2.Object{ObjectId: proto.String(id), ObjectType: proto.String("package"), Version: proto.Uint64(version), Owner: &v2.Owner{Kind: v2.Owner_IMMUTABLE.Enum()}, Bcs: &v2.Bcs{Value: data}}}, nil
	}})
	actual, err := c.ReadChainTypeOrigins(context.Background(), id)
	if err != nil || !reflect.DeepEqual(actual, expected) {
		t.Fatal(actual, err)
	}
}

func TestPackageOriginEnvelopeAndMetadataRejectSubstitution(t *testing.T) {
	id, version, valid, duplicate, _ := originPackageFixture(t)
	for _, mode := range []string{"metadata-id", "metadata-version", "metadata-owner", "metadata-type", "bcs-id", "bcs-version", "bcs-owner", "not-package", "truncated", "trailing", "duplicate", "noncanonical-length"} {
		t.Run(mode, func(t *testing.T) {
			data := append([]byte(nil), valid...)
			obj := &v2.Object{ObjectId: proto.String(id), ObjectType: proto.String("package"), Version: proto.Uint64(version), Owner: &v2.Owner{Kind: v2.Owner_IMMUTABLE.Enum()}}
			switch mode {
			case "metadata-id":
				obj.ObjectId = proto.String("0x99")
			case "metadata-version":
				obj.Version = proto.Uint64(2)
			case "metadata-owner":
				obj.Owner.Kind = v2.Owner_SHARED.Enum()
			case "metadata-type":
				obj.ObjectType = proto.String("move-object")
			case "bcs-id":
				data[32]++
			case "bcs-version":
				data[33]++
			case "bcs-owner":
				data[len(data)-42] = 2
			case "not-package":
				data[0] = 0
			case "truncated":
				data = data[:len(data)-1]
			case "trailing":
				data = append(data, 0)
			case "duplicate":
				data = duplicate
			case "noncanonical-length":
				data = append(append(append([]byte(nil), data[:41]...), 0x83, 0), data[42:]...)
			}
			obj.Bcs = &v2.Bcs{Value: data}
			c := testTransport(t, &transportServer{object: func(*v2.GetObjectRequest) (*v2.GetObjectResponse, error) {
				return &v2.GetObjectResponse{Object: obj}, nil
			}})
			if actual, err := c.ReadChainTypeOrigins(context.Background(), id); err == nil || actual != nil {
				t.Fatal("unsafe immutable package accepted", actual, err)
			}
		})
	}
}
