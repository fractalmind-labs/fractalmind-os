package productcrypto

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"os"
	"strconv"
	"testing"
)

func TestSDKCommandResultWrappingAndDerivation(t *testing.T) {
	data, err := os.ReadFile("testdata/sdk-command-result.json")
	if err != nil {
		t.Fatal(err)
	}
	var f struct{ OrganizationID, CapabilityID, MembershipID, Fingerprint, KeyVersion, OrganizationKey, HostSecret, Key, Wrapped, Context, RecordAAD, Plaintext, Body string }
	if err := json.Unmarshal(data, &f); err != nil {
		t.Fatal(err)
	}
	version, err := strconv.ParseUint(f.KeyVersion, 10, 64)
	if err != nil {
		t.Fatal(err)
	}
	decode := func(value string) []byte {
		b, err := hex.DecodeString(value)
		if err != nil {
			t.Fatal(err)
		}
		return b
	}
	context, err := CommandResultWrapContext(f.OrganizationID, f.CapabilityID, f.MembershipID, f.Fingerprint, version)
	if err != nil || context != f.Context {
		t.Fatalf("context err=%v", err)
	}
	key, err := CommandResultKey(decode(f.OrganizationKey), f.OrganizationID, f.Fingerprint, version)
	if err != nil || hex.EncodeToString(key) != f.Key {
		t.Fatalf("KDF mismatch err=%v", err)
	}
	unwrapped, err := UnwrapResultKey(decode(f.Wrapped), decode(f.HostSecret), context)
	if err != nil || !bytes.Equal(unwrapped, key) {
		t.Fatalf("SDK key unwrap mismatch err=%v", err)
	}
	body := decode(f.Body)
	plaintext, err := DecryptCommandResult(body, unwrapped, f.RecordAAD)
	if err != nil || string(plaintext) != f.Plaintext {
		t.Fatalf("SDK command result decryption err=%v", err)
	}
	if _, err := DecryptCommandResult(body, decode(f.OrganizationKey), f.RecordAAD); err == nil {
		t.Fatal("organization key used as command key")
	}
	if _, err := UnwrapResultKey(decode(f.Wrapped), bytes.Repeat([]byte{8}, 32), context); err == nil {
		t.Fatal("wrong Host accepted")
	}
	if _, err := UnwrapResultKey(decode(f.Wrapped), decode(f.HostSecret), context+":other"); err == nil {
		t.Fatal("wrong command scope accepted")
	}
	lowOrder := decode(f.Wrapped)
	clear(lowOrder[4:36])
	if _, err := UnwrapResultKey(lowOrder, decode(f.HostSecret), context); err == nil {
		t.Fatal("low-order X25519 key accepted")
	}
	other, err := CommandResultKey(decode(f.OrganizationKey), f.OrganizationID, f.Fingerprint, version+1)
	if err != nil || bytes.Equal(other, key) {
		t.Fatal("versions share command key")
	}
	if _, err := DecryptCommandResult(body, other, f.RecordAAD); err == nil {
		t.Fatal("another version decrypted command")
	}
}
