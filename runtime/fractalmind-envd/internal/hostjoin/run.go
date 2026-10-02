package hostjoin

import (
	"context"
	"encoding/hex"
	"fmt"
	"time"

	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/hostidentity"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/nodecommand"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/sui"
)

type Client interface {
	CheckHostJoinChain(context.Context, string) error
	PrepareHostJoin(context.Context, sui.HostJoinRequest) (sui.HostJoinQuote, error)
	RevalidateHostJoinQuote(context.Context, sui.HostJoinQuote) error
	ExecuteHostJoin(context.Context, sui.HostJoinQuote, string) (sui.HostJoinReceipt, error)
	QueryHostJoin(context.Context, sui.HostJoinReceiptRequest) (sui.HostJoinReceipt, error)
}
type Authority interface {
	InspectHostJoin(context.Context, nodecommand.HostJoinInput) (nodecommand.HostJoinPlan, error)
	ReadHostAdmission(context.Context, string, string, []byte, []byte) (nodecommand.HostAdmissionState, error)
}
type Options struct {
	Network, Chain, PackageID, TypesPackageID, RegistryID, ExpectedOrganization, Profile, Name, PublicAddress, JournalRoot string
	GasBudget                                                                                                              uint64
	StatusOnly, NewAttempt                                                                                                 bool
}
type Interaction struct {
	ReadInvitation func() ([]byte, error)
	Confirm        func(nodecommand.HostJoinPlan, sui.HostJoinQuote, hostidentity.Public) (bool, error)
	Prepared       func(Record) error
}
type Result struct {
	State                 string                          `json:"state"`
	Digest                string                          `json:"digest,omitempty"`
	ActualFee             string                          `json:"actual_fee_mist,omitempty"`
	Membership            *nodecommand.HostAdmissionState `json:"membership,omitempty"`
	ReconstructionPending bool                            `json:"membership_reconstruction_pending,omitempty"`
}

// Run owns the namespace lock for the entire interaction. Original queries take
// precedence over new code input, authority checks, signing and broadcasting.
func Run(ctx context.Context, client Client, factory func(string) (Authority, error), keys *hostidentity.Keys, opts Options, ui Interaction) (Result, error) {
	var out Result
	if client == nil || opts.StatusOnly && opts.NewAttempt {
		return out, fmt.Errorf("invalid Host join operation")
	}
	var public hostidentity.Public
	if !opts.StatusOnly {
		if keys == nil {
			return out, fmt.Errorf("initialize this Host identity with --init-host first")
		}
		var err error
		public, err = keys.Public(opts.Profile)
		if err != nil {
			return out, err
		}
		opts.PublicAddress = public.Address
	}
	lockCtx, lockCancel := context.WithTimeout(ctx, 3*time.Second)
	journal, err := OpenJournal(lockCtx, opts.JournalRoot, opts.Chain, opts.PublicAddress)
	lockCancel()
	if err != nil {
		return out, err
	}
	defer journal.Close()
	previous, err := journal.Read()
	if err != nil {
		return out, err
	}
	if err := client.CheckHostJoinChain(ctx, opts.Chain); err != nil {
		if previous != nil {
			out.State = "unknown"
			out.Digest = previous.Digest
		}
		return out, err
	}
	if previous != nil {
		out.Digest = previous.Digest
		receipt, queryErr := client.QueryHostJoin(ctx, sui.HostJoinReceiptRequest{Digest: previous.Digest, Sender: previous.Sender, GasBudget: previous.GasBudget, GasPrice: previous.GasPrice})
		if queryErr != nil || (receipt.Status != "confirmed" && receipt.Status != "failed") || receipt.Digest != previous.Digest {
			out.State = "unknown"
			return out, fmt.Errorf("original Host join outcome is unknown; query digest %s, do not replay", previous.Digest)
		}
		out.State, out.ActualFee = receipt.Status, receipt.ActualFee
		if opts.StatusOnly {
			return out, nil
		}
		if !opts.NewAttempt {
			return reconstruct(ctx, out, previous, factory, public)
		}
	} else if opts.StatusOnly {
		return out, fmt.Errorf("no original Host join digest for this address and chain")
	}
	if !canonicalID(opts.PackageID) || !canonicalID(opts.TypesPackageID) || !canonicalID(opts.RegistryID) || opts.GasBudget == 0 || (opts.ExpectedOrganization != "" && !canonicalID(opts.ExpectedOrganization)) || ui.ReadInvitation == nil || ui.Confirm == nil || ui.Prepared == nil || factory == nil {
		return Result{}, fmt.Errorf("Host join requires explicit network, protocol IDs, Gas budget and confirmation")
	}
	authority, err := factory(opts.TypesPackageID)
	if err != nil {
		return Result{}, err
	}
	code, err := ui.ReadInvitation()
	if err != nil {
		return Result{}, err
	}
	defer clear(code)
	invitation, err := nodecommand.ParseHostInvitation(code, opts.Network)
	clear(code)
	if err != nil {
		return Result{}, err
	}
	defer invitation.Close()
	host, err := hex.DecodeString(public.SigningPublicKey)
	if err != nil {
		return Result{}, err
	}
	enc, err := hex.DecodeString(public.EncryptionPublicKey)
	if err != nil {
		return Result{}, err
	}
	input := nodecommand.HostJoinInput{Network: opts.Network, ProtocolRegistry: opts.RegistryID, InviteID: invitation.ID, ExpectedOrganization: opts.ExpectedOrganization, HostAddress: public.Address, ProofPublicKey: invitation.PublicKey(), HostPublicKey: host, EncryptionPublicKey: enc}
	inspect := func() (nodecommand.HostJoinPlan, error) {
		readCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
		defer cancel()
		return authority.InspectHostJoin(readCtx, input)
	}
	plan, err := inspect()
	if err != nil {
		return Result{}, err
	}
	proof, err := invitation.SignJoin(plan, host, enc)
	if err != nil {
		return Result{}, err
	}
	quote, err := client.PrepareHostJoin(ctx, sui.HostJoinRequest{PackageID: opts.PackageID, ChainIdentifier: opts.Chain, Sender: public.Address, OrganizationID: plan.OrganizationID, InviteID: plan.InviteID, BindingID: plan.BindingID, IssuerHuman: plan.IssuerHuman, IssuerGrant: plan.IssuerGrant, HostPublicKey: host, EncryptionPublicKey: enc, ProofSignature: proof, Name: opts.Name, ProofExpiresAtMS: plan.ProofExpiresAtMS, GasBudget: opts.GasBudget})
	if err != nil {
		return Result{}, err
	}
	confirmed, err := ui.Confirm(plan, quote, public)
	if err != nil {
		return Result{}, err
	}
	if !confirmed {
		return Result{State: "cancelled"}, nil
	}
	check := func() error {
		fresh, err := inspect()
		if err != nil {
			return err
		}
		if fresh.VersionPin != plan.VersionPin || fresh.ClockMS >= plan.ProofExpiresAtMS {
			return fmt.Errorf("Host join authority or proof deadline changed; prepare a new preview")
		}
		return nil
	}
	if err = check(); err != nil {
		return Result{}, err
	}
	private, err := keys.SigningPrivate()
	if err != nil {
		return Result{}, err
	}
	signature, err := sui.SignHostJoinQuote(quote, private)
	clear(private)
	if err != nil {
		return Result{}, err
	}
	if err = check(); err != nil {
		return Result{}, err
	}
	if err = client.RevalidateHostJoinQuote(ctx, quote); err != nil {
		return Result{}, err
	}
	record := Record{Format: 1, Chain: opts.Chain, Sender: public.Address, Digest: quote.Digest, GasBudget: quote.GasBudget, GasPrice: quote.GasPrice, PackageID: opts.PackageID, TypesPackageID: opts.TypesPackageID, OrganizationID: plan.OrganizationID, InviteID: plan.InviteID}
	if previous != nil {
		if err = journal.Archive(previous.Digest); err != nil {
			return Result{}, err
		}
	}
	if err = journal.WriteNew(record); err != nil {
		return Result{State: "unknown", Digest: record.Digest}, err
	}
	if err = ui.Prepared(record); err != nil {
		return Result{State: "unknown", Digest: record.Digest}, err
	}
	receipt, submitErr := client.ExecuteHostJoin(ctx, quote, signature)
	if submitErr != nil || receipt.Digest != record.Digest || (receipt.Status != "confirmed" && receipt.Status != "failed") {
		// One read-only recovery attempt. Never execute the signed bytes again.
		receipt, err = client.QueryHostJoin(ctx, sui.HostJoinReceiptRequest{Digest: record.Digest, Sender: record.Sender, GasBudget: record.GasBudget, GasPrice: record.GasPrice})
		if err != nil || receipt.Digest != record.Digest || (receipt.Status != "confirmed" && receipt.Status != "failed") {
			return Result{State: "unknown", Digest: record.Digest}, fmt.Errorf("Host join result unknown; query original digest %s", record.Digest)
		}
	}
	return reconstruct(ctx, Result{State: receipt.Status, Digest: record.Digest, ActualFee: receipt.ActualFee}, &record, factory, public)
}
func reconstruct(ctx context.Context, out Result, record *Record, factory func(string) (Authority, error), public hostidentity.Public) (Result, error) {
	if out.State != "confirmed" {
		return out, nil
	}
	if factory == nil {
		out.ReconstructionPending = true
		return out, fmt.Errorf("membership source reader unavailable; query original digest %s", record.Digest)
	}
	authority, err := factory(record.TypesPackageID)
	if err != nil {
		out.ReconstructionPending = true
		return out, err
	}
	host, err := hex.DecodeString(public.SigningPublicKey)
	if err != nil {
		return out, err
	}
	enc, err := hex.DecodeString(public.EncryptionPublicKey)
	if err != nil {
		return out, err
	}
	readCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	member, err := authority.ReadHostAdmission(readCtx, record.OrganizationID, record.InviteID, host, enc)
	if err != nil {
		out.ReconstructionPending = true
		return out, fmt.Errorf("transaction confirmed; membership reconstruction pending, query original digest %s", record.Digest)
	}
	out.Membership = &member
	return out, nil
}
