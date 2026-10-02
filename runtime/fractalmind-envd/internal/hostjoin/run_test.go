package hostjoin

import (
	"context"
	"errors"
	"testing"

	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/hostidentity"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/sui"
)

type fixtureKeyStore struct{}

func (fixtureKeyStore) Get(string) ([]byte, error) {
	data := append([]byte{}, []byte("FMH1")...)
	for range 64 {
		data = append(data, 77)
	}
	return data, nil
}
func (fixtureKeyStore) Create(string, []byte) error { return errors.New("creation forbidden") }

type originalClient struct {
	receipt                sui.HostJoinReceipt
	queryError, chainError error
	queries, newOperations int
}

func (c *originalClient) CheckHostJoinChain(context.Context, string) error { return c.chainError }
func (c *originalClient) QueryHostJoin(_ context.Context, r sui.HostJoinReceiptRequest) (sui.HostJoinReceipt, error) {
	c.queries++
	return c.receipt, c.queryError
}
func (c *originalClient) PrepareHostJoin(context.Context, sui.HostJoinRequest) (sui.HostJoinQuote, error) {
	c.newOperations++
	return sui.HostJoinQuote{}, errors.New("must not prepare")
}
func (c *originalClient) RevalidateHostJoinQuote(context.Context, sui.HostJoinQuote) error {
	c.newOperations++
	return errors.New("must not revalidate")
}
func (c *originalClient) ExecuteHostJoin(context.Context, sui.HostJoinQuote, string) (sui.HostJoinReceipt, error) {
	c.newOperations++
	return sui.HostJoinReceipt{}, errors.New("must not execute")
}
func TestHostJoinOriginalQueryPrecedesNewCodeAndAuthority(t *testing.T) {
	for _, mode := range []string{"unknown", "force unknown", "failed", "status confirmed", "network unavailable", "missing fee projection"} {
		t.Run(mode, func(t *testing.T) {
			keys, err := hostidentity.Load(fixtureKeyStore{}, "fixture")
			if err != nil {
				t.Fatal(err)
			}
			defer keys.Close()
			public, err := keys.Public("fixture")
			if err != nil {
				t.Fatal(err)
			}
			r := recordFixture()
			r.Sender = public.Address
			root := t.TempDir()
			j, err := OpenJournal(context.Background(), root, r.Chain, r.Sender)
			if err != nil {
				t.Fatal(err)
			}
			if err = j.WriteNew(r); err != nil {
				t.Fatal(err)
			}
			j.Close()
			client := &originalClient{receipt: sui.HostJoinReceipt{Digest: r.Digest, Status: "failed", ActualFee: "31"}}
			opts := Options{Chain: r.Chain, Profile: "fixture", JournalRoot: root, PublicAddress: r.Sender}
			if mode == "unknown" || mode == "force unknown" {
				client.queryError = errors.New("RPC response unavailable")
			}
			if mode == "force unknown" {
				opts.NewAttempt = true
			}
			if mode == "network unavailable" {
				client.chainError = errors.New("offline")
			}
			if mode == "status confirmed" {
				opts.StatusOnly = true
				keys.Close()
				keys = nil
				client.receipt.Status = "confirmed"
			}
			if mode == "missing fee projection" {
				client.receipt.Status = "unknown"
			}
			reads := 0
			result, err := Run(context.Background(), client, nil, keys, opts, Interaction{ReadInvitation: func() ([]byte, error) { reads++; return nil, errors.New("must not ask for a new code") }})
			if reads != 0 || client.newOperations != 0 || result.Digest != r.Digest {
				t.Fatal("original query requested new credentials/transaction")
			}
			if mode == "failed" || mode == "status confirmed" {
				if err != nil || result.ActualFee != "31" || result.State != client.receipt.Status {
					t.Fatalf("terminal original lost %+v %v", result, err)
				}
			} else if err == nil || result.State != "unknown" {
				t.Fatalf("uncertain original lost %+v %v", result, err)
			}
		})
	}
}
