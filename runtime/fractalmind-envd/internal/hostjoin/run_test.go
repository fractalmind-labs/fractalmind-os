package hostjoin

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/hostidentity"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/nodecommand"
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

type delayedAdmission struct {
	read func(context.Context, string, string, []byte, []byte) (nodecommand.HostAdmissionState, error)
}

func (a delayedAdmission) InspectHostJoin(context.Context, nodecommand.HostJoinInput) (nodecommand.HostJoinPlan, error) {
	return nodecommand.HostJoinPlan{}, errors.New("must not inspect a new invitation")
}
func (a delayedAdmission) ReadHostAdmission(ctx context.Context, org, invite string, host, encryption []byte) (nodecommand.HostAdmissionState, error) {
	return a.read(ctx, org, invite, host, encryption)
}

func TestConfirmedAdmissionVisibilityDoesNotReplay(t *testing.T) {
	for _, mode := range []string{"visible later", "revoked later", "invalid provenance", "deadline"} {
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
			journal, err := OpenJournal(context.Background(), root, r.Chain, r.Sender)
			if err != nil {
				t.Fatal(err)
			}
			if err = journal.WriteNew(r); err != nil {
				t.Fatal(err)
			}
			journal.Close()
			client := &originalClient{receipt: sui.HostJoinReceipt{Digest: r.Digest, Status: "confirmed", ActualFee: "31"}}
			reads := 0
			invalid := errors.New("membership provenance mismatch")
			authority := delayedAdmission{read: func(_ context.Context, org, invite string, host, encryption []byte) (nodecommand.HostAdmissionState, error) {
				reads++
				if org != r.OrganizationID || invite != r.InviteID || len(host) != 32 || len(encryption) != 32 {
					t.Fatal("reconstruction changed the original namespace or Host keys")
				}
				if mode == "invalid provenance" {
					return nodecommand.HostAdmissionState{}, invalid
				}
				if reads == 1 || mode == "deadline" {
					return nodecommand.HostAdmissionState{}, nodecommand.ErrChainObjectNotFound
				}
				return nodecommand.HostAdmissionState{OrganizationID: org, InviteID: invite, MembershipID: org, HostAddress: public.Address, Current: mode != "revoked later", Revoked: mode == "revoked later"}, nil
			}}
			factory := func(original string) (Authority, error) {
				if original != r.TypesPackageID {
					t.Fatal("original datatype package changed")
				}
				return authority, nil
			}
			ctx := context.Background()
			if mode == "deadline" {
				var cancel context.CancelFunc
				ctx, cancel = context.WithTimeout(ctx, 25*time.Millisecond)
				defer cancel()
			}
			result, err := Run(ctx, client, factory, keys, Options{Chain: r.Chain, Profile: "fixture", JournalRoot: root}, Interaction{ReadInvitation: func() ([]byte, error) {
				t.Fatal("reconstruction requested a new invitation")
				return nil, nil
			}})
			if result.State != "confirmed" || result.Digest != r.Digest || result.ActualFee != "31" || client.queries != 1 || client.newOperations != 0 {
				t.Fatalf("original receipt or single-query/no-replay invariant lost: %+v", result)
			}
			switch mode {
			case "visible later", "revoked later":
				if err != nil || reads != 2 || result.ReconstructionPending || result.Membership == nil || result.Membership.Current != (mode == "visible later") || result.Membership.Revoked != (mode == "revoked later") {
					t.Fatalf("latest chain membership not preserved: %+v, %v", result, err)
				}
			case "invalid provenance":
				if !errors.Is(err, invalid) || reads != 1 || !result.ReconstructionPending || result.Membership != nil {
					t.Fatal("invalid provenance was retried or its original cause lost")
				}
			case "deadline":
				if !errors.Is(err, context.DeadlineExceeded) || reads != 1 || !result.ReconstructionPending || result.Membership != nil {
					t.Fatal("missing member escaped the original reconstruction deadline")
				}
			}
		})
	}
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
