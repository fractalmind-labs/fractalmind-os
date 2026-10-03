package sui

import (
	"context"
	"crypto/ecdh"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"strings"
	"testing"
	"time"

	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/nodecommand"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/productcrypto"
	"golang.org/x/crypto/hkdf"
)

func encryptedDeliveryFixture(t *testing.T) (*ChainExecutionStore, *resultReaderFixture, nodecommand.ChainCommandDelivery, nodecommand.NodeCommand, []byte) {
	t.Helper()
	store, reader, _, command, _, key := chainStoreFixture(t)
	private := ed25519.NewKeyFromSeed(bytesRepeated(10, 32))
	defer clear(private)
	device := &Keypair{Private: private, Public: private.Public().(ed25519.PublicKey)}
	command.Signer = device.Address()
	command.IssuedAtMS = time.Now().UnixMilli()
	command.ExpiresAtMS = command.IssuedAtMS + 60000
	command.Payload = json.RawMessage(`{"task":"original private message"}`)
	command.PayloadHash = nodecommand.HashPayload(command.Payload)
	signing, err := command.SigningBytes()
	if err != nil {
		t.Fatal(err)
	}
	command.Signature = "ed25519:" + hex.EncodeToString(device.Public) + ":" + hex.EncodeToString(ed25519.Sign(private, signing))
	reservation, err := commandReservation(command)
	if err != nil {
		t.Fatal(err)
	}
	reader.run.Signer = command.Signer
	reader.run.Fingerprint = reservation.Fingerprint
	reader.run.IssuedAtMS = command.IssuedAtMS
	reader.run.ExpiresAtMS = command.ExpiresAtMS
	reader.run.State = 0
	reader.run.AttemptID = ""
	wrappingContext, _ := productcrypto.CommandResultWrapContext(command.Target.OrganizationID, command.Capability.ID, reader.run.MembershipID, reservation.Fingerprint, 1)
	host, _ := ecdh.X25519().NewPrivateKey(bytesRepeated(7, 32))
	ephemeral, _ := ecdh.X25519().NewPrivateKey(bytesRepeated(8, 32))
	shared, err := ephemeral.ECDH(host.PublicKey())
	if err != nil {
		t.Fatal(err)
	}
	defer clear(shared)
	salt := bytesRepeated(1, 32)
	wrapping := make([]byte, 32)
	defer clear(wrapping)
	if _, err = io.ReadFull(hkdf.New(sha256.New, shared, salt, []byte("fractalmind.key-wrap.v1:"+wrappingContext)), wrapping); err != nil {
		t.Fatal(err)
	}
	wrapped, err := productcrypto.Encrypt(key, wrapping, wrappingContext)
	if err != nil {
		t.Fatal(err)
	}
	envelope := append([]byte("FMW1"), ephemeral.PublicKey().Bytes()...)
	envelope = append(envelope, salt...)
	envelope = append(envelope, wrapped...)
	reader.grant.WrappedKey = envelope
	body, err := json.Marshal(command)
	if err != nil {
		t.Fatal(err)
	}
	domain, _ := productcrypto.CommandDeliveryContext(command.Target.OrganizationID, command.Capability.ID, reader.run.MembershipID, reservation.Fingerprint, 1)
	ciphertext, err := productcrypto.Encrypt(body, key, domain)
	if err != nil {
		t.Fatal(err)
	}
	ciphertext[3] = '3'
	return store, reader, nodecommand.ChainCommandDelivery{Run: reader.run, KeyVersion: 1, EncryptedCommand: ciphertext, QueuedAtMS: uint64(command.IssuedAtMS)}, command, key
}
func TestDeliveryOpensExactOriginalWithoutExecutionAndRejectsUnknownCheckpoint(t *testing.T) {
	store, reader, delivery, command, key := encryptedDeliveryFixture(t)
	defer clear(key)
	got, err := store.OpenCommandDelivery(context.Background(), delivery)
	if err != nil || got.Signature != command.Signature || string(got.Payload) != string(command.Payload) {
		t.Fatalf("exact command not restored: %v", err)
	}
	if reader.run.State != 0 || reader.run.ResultRecordID != "" {
		t.Fatal("decryption executed")
	}
	for _, state := range []uint8{1, 2, 3, 4, 5} {
		reader.run.State = state
		if _, err = store.OpenCommandDelivery(context.Background(), delivery); err == nil {
			t.Fatal("changed checkpoint permitted replay", state)
		}
	}
}
func TestDeliveryRejectsCiphertextContextPayloadSignatureAndTrailingData(t *testing.T) {
	for _, mode := range []string{"ciphertext", "member", "key version", "expired", "stopped", "payload", "signature", "trailing", "unknown field"} {
		t.Run(mode, func(t *testing.T) {
			store, reader, delivery, command, key := encryptedDeliveryFixture(t)
			defer clear(key)
			domain, _ := productcrypto.CommandDeliveryContext(delivery.Run.Target.OrganizationID, delivery.Run.CapabilityID, delivery.Run.MembershipID, delivery.Run.Fingerprint, 1)
			switch mode {
			case "ciphertext":
				delivery.EncryptedCommand[32] ^= 1
			case "member":
				delivery.Run.MembershipID = "0x" + strings.Repeat("e", 64)
			case "key version":
				delivery.KeyVersion = 2
			case "expired":
				delivery.Run.ExpiresAtMS = time.Now().UnixMilli()
			case "stopped":
				delivery.Run.StopRequested = true
			default:
				if mode == "payload" {
					command.Payload = json.RawMessage(`{"injected":true}`)
				}
				if mode == "signature" {
					command.Signature = "ed25519:invalid"
				}
				plaintext, _ := json.Marshal(command)
				if mode == "trailing" {
					plaintext = append(plaintext, []byte(" {}")...)
				}
				if mode == "unknown field" {
					plaintext = append(plaintext[:len(plaintext)-1], []byte(`,"injected":true}`)...)
				}
				cipher, err := productcrypto.Encrypt(plaintext, key, domain)
				if err != nil {
					t.Fatal(err)
				}
				cipher[3] = '3'
				delivery.EncryptedCommand = cipher
			}
			if _, err := store.OpenCommandDelivery(context.Background(), delivery); err == nil {
				t.Fatal("unsafe delivery decoded")
			}
			if reader.run.State != 0 {
				t.Fatal("negative check started Run")
			}
		})
	}
}
