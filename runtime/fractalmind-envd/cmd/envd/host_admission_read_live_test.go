package main

import (
	"bufio"
	"context"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/config"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/sui"
)

// This fixture only reconstructs existing admission and connection objects.
// Its stdin contains public configuration and keys, never an invitation or a
// private key. It does not initialize identities, sign, or submit transactions.
func TestHostAdmissionReadLive(t *testing.T) {
	if os.Getenv("FM_HOST_ADMISSION_READ_LIVE") != "1" {
		t.Skip("explicit existing localnet admission read only")
	}
	frame, err := bufio.NewReaderSize(os.Stdin, 4096).ReadBytes('\n')
	if err != nil || len(frame) > 4096 {
		t.Fatal("invalid public admission fixture input")
	}
	var input struct {
		ConfigPath, InviteID, MembershipID, SigningPublicKey, EncryptionPublicKey string
	}
	if json.Unmarshal(frame, &input) != nil || input.ConfigPath == "" {
		t.Fatal("invalid public admission fixture input")
	}
	cfg, err := config.Load(input.ConfigPath)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.SUI.Network != "localnet" || cfg.SUI.RPC != "http://127.0.0.1:29000" {
		t.Fatal("fixture requires the isolated pinned localnet")
	}
	host, err := hex.DecodeString(input.SigningPublicKey)
	if err != nil || len(host) != 32 {
		t.Fatal("invalid public Host signing key")
	}
	enc, err := hex.DecodeString(input.EncryptionPublicKey)
	if err != nil || len(enc) != 32 {
		t.Fatal("invalid public Host encryption key")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	rpc, err := sui.NewGRPCClient(cfg.SUI.RPC, cfg.SUI.GraphQLURL)
	if err != nil {
		t.Fatal(err)
	}
	defer rpc.Close()
	if err := rpc.CheckHostJoinChain(ctx, cfg.SUI.ChainIdentifier); err != nil {
		t.Fatal(err)
	}
	reader, err := connectionResolver(cfg, rpc)
	if err != nil {
		t.Fatal(err)
	}
	member, err := reader.ReadHostAdmission(ctx, cfg.SUI.OrgID, input.InviteID, host, enc)
	if err != nil {
		t.Fatalf("read original admission: %v", err)
	}
	if member.MembershipID != input.MembershipID || !member.Current || member.Revoked {
		t.Fatal("original admission is not the expected current membership")
	}
	connection, err := reader.ReadHostConnection(ctx, cfg.SUI.OrgID, host, enc)
	if err != nil {
		t.Fatalf("read current connection: %v", err)
	}
	if connection.MembershipID != member.MembershipID || connection.BindingID != member.BindingID {
		t.Fatal("connection and original admission disagree")
	}
	result, err := json.Marshal(struct {
		Membership any `json:"membership"`
		Connection any `json:"connection"`
		Broadcasts int `json:"broadcasts"`
	}{member, connection, 0})
	if err != nil {
		t.Fatal(err)
	}
	fmt.Printf("FM_HOST_ADMISSION_READ_RESULT %s\n", result)
}
