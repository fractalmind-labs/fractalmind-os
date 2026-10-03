package productcrypto

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"os"
	"strings"
	"testing"
)

func TestDecryptSDKContent(t *testing.T) {
	data, err := os.ReadFile("testdata/sdk-content.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct{ Key, Plaintext, Context, Envelope string }
	if err := json.Unmarshal(data, &fixture); err != nil {
		t.Fatal(err)
	}
	key, _ := hex.DecodeString(fixture.Key)
	envelope, _ := hex.DecodeString(fixture.Envelope)
	plaintext, err := Decrypt(envelope, key, fixture.Context)
	if err != nil || string(plaintext) != fixture.Plaintext {
		t.Fatalf("SDK interoperability err=%v", err)
	}
	generated, err := Encrypt(plaintext, key, fixture.Context)
	if err != nil {
		t.Fatal(err)
	}
	if os.Getenv("FM_EMIT_PUBLIC_TEST_VECTOR") == "1" {
		// This key is the public synthetic test fixture, never a Host/device key.
		encoded, err := json.Marshal(map[string]string{"description": "Synthetic Go → SDK interoperability fixture; public test key", "key": fixture.Key, "plaintext": fixture.Plaintext, "context": fixture.Context, "envelope": hex.EncodeToString(generated)})
		if err != nil {
			t.Fatal(err)
		}
		t.Logf("FM_CONTENT_EVIDENCE %s", encoded)
	}
}

func TestContentAuthenticatesBodyKeyAndContext(t *testing.T) {
	key := bytes.Repeat([]byte{9}, 32)
	context := "test:organization:checkpoint:command-1:1:2"
	plaintext := []byte("结果与证据")
	first, err := Encrypt(plaintext, key, context)
	if err != nil {
		t.Fatal(err)
	}
	second, err := Encrypt(plaintext, key, context)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Equal(first, second) || len(first) != len(plaintext)+32 {
		t.Fatal("nonce reuse or wrong envelope layout")
	}
	for _, position := range []int{0, 4, 16, len(first) - 1} {
		changed := append([]byte(nil), first...)
		changed[position] ^= 1
		if _, err := Decrypt(changed, key, context); err == nil {
			t.Fatalf("mutation at %d accepted", position)
		}
	}
	if _, err := Decrypt(first, bytes.Repeat([]byte{1}, 32), context); err == nil {
		t.Fatal("wrong key accepted")
	}
	if _, err := Decrypt(first, key, context+":other"); err == nil {
		t.Fatal("wrong context accepted")
	}
}

func TestContentChainSizeAndInputLimits(t *testing.T) {
	key := bytes.Repeat([]byte{7}, 32)
	body, err := Encrypt(make([]byte, MaxPlaintextBytes), key, "test")
	if err != nil || len(body) != 65536 {
		t.Fatalf("limit err=%v size=%d", err, len(body))
	}
	if result, err := Decrypt(body, key, "test"); err != nil || len(result) != MaxPlaintextBytes {
		t.Fatal("maximum body cannot round-trip")
	}
	if _, err := Encrypt(make([]byte, MaxPlaintextBytes+1), key, "test"); err == nil {
		t.Fatal("oversize accepted")
	}
	for _, invalid := range [][]byte{nil, []byte("FME1"), append(body, 0)} {
		if _, err := Decrypt(invalid, key, "test"); err == nil {
			t.Fatal("invalid envelope accepted")
		}
	}
	for _, context := range []string{"", strings.Repeat("a", 1025)} {
		if _, err := Encrypt(nil, key, context); err == nil {
			t.Fatal("invalid context accepted")
		}
	}
	if _, err := Encrypt(nil, make([]byte, 16), "test"); err == nil {
		t.Fatal("short key accepted")
	}
}
