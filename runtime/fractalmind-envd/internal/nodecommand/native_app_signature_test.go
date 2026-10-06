package nodecommand

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"os"
	"testing"
)

// The SDK-generated public vector is also signed and byte-compared by the
// native Rust vault. Verify it here with the production envd verifier, not a
// test signature stub or Sui personal-message intent.
func TestNativeAppCommandSignatureAcrossSDKRustAndEnvd(t *testing.T) {
	data, err := os.ReadFile("../../../../apps/fractalmind-app/native/testdata/node-command-v1.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		Bytes   string      `json:"bytes"`
		Command NodeCommand `json:"command"`
	}
	if err := json.Unmarshal(data, &fixture); err != nil {
		t.Fatal(err)
	}
	expected, err := base64.StdEncoding.DecodeString(fixture.Bytes)
	if err != nil {
		t.Fatal(err)
	}
	actual, err := fixture.Command.SigningBytes()
	if err != nil {
		t.Fatal(err)
	}
	if string(expected) != string(actual) {
		t.Fatal("native/SDK bytes differ from envd canonical bytes")
	}
	if HashPayload(fixture.Command.Payload) != fixture.Command.PayloadHash {
		t.Fatal("payload hash mismatch")
	}
	verifier := Ed25519Verifier{}
	if err := verifier.Verify(context.Background(), fixture.Command.Signer, actual, fixture.Command.Signature); err != nil {
		t.Fatal(err)
	}
	fixture.Command.Target.AgentID = "another-instance"
	changed, err := fixture.Command.SigningBytes()
	if err != nil {
		t.Fatal(err)
	}
	if err := verifier.Verify(context.Background(), fixture.Command.Signer, changed, fixture.Command.Signature); err == nil {
		t.Fatal("signature accepted another instance")
	}
}
