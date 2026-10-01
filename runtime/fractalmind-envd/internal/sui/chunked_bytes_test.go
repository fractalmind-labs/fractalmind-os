package sui

import (
	"bytes"
	"testing"

	v2 "github.com/block-vision/sui-go-sdk/pb/sui/rpc/v2"
)

func TestChunkedBytesStayAtomicAndReconstructOriginalPayload(t *testing.T) {
	for _, size := range []int{0, 1, 16000, 16001, 65536} {
		data := bytes.Repeat([]byte{255}, size)
		ptb := &v2.ProgrammableTransaction{}
		arg, err := appendMoveArgument(ptb, "0x2", ChunkedBytes(data))
		if err != nil {
			t.Fatal(err)
		}
		var recovered []byte
		for _, input := range ptb.Inputs {
			values := input.GetLiteral().GetListValue().GetValues()
			if len(values) > 16000 {
				t.Fatal("pure input exceeds chunk size")
			}
			for _, value := range values {
				if value.GetStringValue() != "255" {
					t.Fatalf("byte changed: %v", value)
				}
				recovered = append(recovered, 255)
			}
		}
		if !bytes.Equal(recovered, data) {
			t.Fatalf("payload lost at %d", size)
		}
		if len(ptb.Commands) == 0 {
			if arg.GetKind() != v2.Argument_INPUT {
				t.Fatal("small vector should be a pure input")
			}
		} else {
			if arg.GetKind() != v2.Argument_RESULT || int(arg.GetResult()) != len(ptb.Commands)-1 {
				t.Fatal("final vector does not reference the last append")
			}
			for i, command := range ptb.Commands {
				call := command.GetMoveCall()
				if call.GetModule() != "wire_bytes" || call.GetFunction() != "append_bytes" {
					t.Fatal("chunk requires unexpected mutation")
				}
				if i > 0 && int(call.Arguments[0].GetResult()) != i-1 {
					t.Fatal("append chain lost prior vector")
				}
			}
		}
	}
	if _, err := appendMoveArgument(&v2.ProgrammableTransaction{}, "0x2", ChunkedBytes(make([]byte, 65537))); err == nil {
		t.Fatal("oversize payload accepted")
	}
}
