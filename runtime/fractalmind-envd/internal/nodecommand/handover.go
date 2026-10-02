package nodecommand

import (
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"slices"
)

// A proposed agreement is not authority. A status command can ask the native
// adapter to review it, without starting, changing or approving an OKR.
type HandoverProposal struct {
	Version           string              `json:"version"`
	ManagedAgentID    string              `json:"managed_agent_id"`
	ManagedVersion    Uint64String        `json:"managed_version"`
	OkrID             string              `json:"okr_id"`
	OkrVersion        Uint64String        `json:"okr_version"`
	SpecRevision      Uint64String        `json:"spec_revision"`
	WorkspaceHash     string              `json:"workspace_hash"`
	Paths             map[string][]string `json:"paths"`
	BudgetAsset       string              `json:"budget_asset"`
	BudgetLimit       Uint64String        `json:"budget_limit"`
	MaxCalls          Uint64String        `json:"max_calls"`
	ExpiresAtMS       int64               `json:"expires_at_ms"`
	Nonce             string              `json:"nonce"`
	ReviewExpiresAtMS int64               `json:"review_expires_at_ms"`
}

func canonicalHex(value string, length int) ([]byte, error) {
	data, err := hex.DecodeString(value)
	if err != nil || len(data) != length || hex.EncodeToString(data) != value {
		return nil, fmt.Errorf("canonical hex required")
	}
	return data, nil
}
func canonicalHandoverID(value string) (moveAddress, error) {
	parsed, err := chainAddress(value)
	if err != nil || parsed.String() != value {
		return parsed, fmt.Errorf("canonical handover ID required")
	}
	return parsed, nil
}
func appendHandoverU64(out []byte, value uint64) []byte {
	var data [8]byte
	binary.LittleEndian.PutUint64(data[:], value)
	return append(out, data[:]...)
}
func (p HandoverProposal) Hash() (string, error) {
	if p.Version != "1" || p.ManagedVersion == 0 || p.OkrVersion == 0 || p.SpecRevision == 0 || p.BudgetAsset != "TOOL_CALLS" || p.BudgetLimit == 0 || p.MaxCalls == 0 || p.MaxCalls > 1000 || p.MaxCalls > p.BudgetLimit || p.ExpiresAtMS <= 0 || p.ExpiresAtMS > 9007199254740991 || p.ReviewExpiresAtMS <= 0 || p.ReviewExpiresAtMS > p.ExpiresAtMS {
		return "", fmt.Errorf("invalid handover agreement")
	}
	managed, err := canonicalHandoverID(p.ManagedAgentID)
	if err != nil {
		return "", err
	}
	okr, err := canonicalHandoverID(p.OkrID)
	if err != nil {
		return "", err
	}
	workspace, err := canonicalHex(p.WorkspaceHash, 32)
	if err != nil {
		return "", err
	}
	nonce, err := canonicalHex(p.Nonce, 32)
	if err != nil {
		return "", err
	}
	boundary, err := ExecutionBoundaryHash(p.Paths)
	if err != nil {
		return "", err
	}
	boundaryBytes, _ := hex.DecodeString(boundary)
	out := []byte("fractalmind.handover-proposal.v1")
	out = append(out, 1)
	out = append(out, managed[:]...)
	out = append(out, okr[:]...)
	for _, n := range []uint64{uint64(p.ManagedVersion), uint64(p.OkrVersion), uint64(p.SpecRevision)} {
		out = appendHandoverU64(out, n)
	}
	out = appendBCSBytes(out, workspace)
	out = appendBCSBytes(out, boundaryBytes)
	out = appendBCSBytes(out, []byte(p.BudgetAsset))
	for _, n := range []uint64{uint64(p.BudgetLimit), uint64(p.MaxCalls), uint64(p.ExpiresAtMS), uint64(p.ReviewExpiresAtMS)} {
		out = appendHandoverU64(out, n)
	}
	out = appendBCSBytes(out, nonce)
	hash := sha256.Sum256(out)
	return hex.EncodeToString(hash[:]), nil
}

type HandoverAuthority struct {
	ProposalHash     string
	CoverageRevision Uint64String
	ClockMS          int64
}
type HandoverAuthorityReader interface {
	InspectHandover(context.Context, NodeCommand, ChainExecution, HandoverProposal) (HandoverAuthority, error)
}

// ProposalForCommand binds the review to the bytes covered by the device
// signature. It does not authorize any execution or refresh an old review.
func ProposalForCommand(command NodeCommand) (HandoverProposal, error) {
	var payload struct {
		Review *HandoverProposal `json:"handover_review"`
	}
	if command.Action != "status" || command.Scope != "observation" || HashPayload(command.Payload) != command.PayloadHash {
		return HandoverProposal{}, fmt.Errorf("review requires an exact signed status payload")
	}
	if err := json.Unmarshal(command.Payload, &payload); err != nil || payload.Review == nil {
		return HandoverProposal{}, fmt.Errorf("missing handover proposal")
	}
	if _, err := payload.Review.Hash(); err != nil {
		return HandoverProposal{}, err
	}
	return *payload.Review, nil
}

type HandoverAcceptance struct {
	Version          string           `json:"version"`
	ExecutionID      string           `json:"execution_id"`
	OrganizationID   string           `json:"organization_id"`
	HumanID          string           `json:"human_id"`
	GrantID          string           `json:"grant_id"`
	MembershipID     string           `json:"membership_id"`
	BindingID        string           `json:"binding_id"`
	HostAddress      string           `json:"host_address"`
	InstanceID       string           `json:"instance_id"`
	Proposal         HandoverProposal `json:"proposal"`
	CoverageRevision Uint64String     `json:"coverage_revision"`
	ObservedAtMS     int64            `json:"observed_at_ms"`
	Signature        string           `json:"signature,omitempty"`
}

func (a HandoverAcceptance) SigningBytes() ([]byte, error) {
	hash, err := a.Proposal.Hash()
	if err != nil {
		return nil, err
	}
	if a.Version != "1" || a.CoverageRevision == 0 || a.ObservedAtMS <= 0 || a.ObservedAtMS >= a.Proposal.ReviewExpiresAtMS || a.Proposal.ReviewExpiresAtMS-a.ObservedAtMS > 60_000 || len(a.InstanceID) != 71 || a.InstanceID[:7] != "native-" {
		return nil, fmt.Errorf("invalid native acceptance")
	}
	if _, err := canonicalHex(a.InstanceID[7:], 32); err != nil {
		return nil, err
	}
	out := []byte("fractalmind.handover-acceptance.v1")
	out = append(out, 1)
	for _, value := range []string{a.ExecutionID, a.OrganizationID, a.HumanID, a.GrantID, a.MembershipID, a.BindingID, a.HostAddress} {
		address, err := canonicalHandoverID(value)
		if err != nil {
			return nil, err
		}
		out = append(out, address[:]...)
	}
	out = appendBCSBytes(out, []byte(a.InstanceID))
	hashed, _ := hex.DecodeString(hash)
	out = appendBCSBytes(out, hashed)
	out = appendHandoverU64(out, uint64(a.CoverageRevision))
	out = appendHandoverU64(out, uint64(a.ObservedAtMS))
	return out, nil
}

func (a HandoverAcceptance) ValidateCommand(command NodeCommand, run ChainExecution) error {
	p, err := ProposalForCommand(command)
	if err != nil {
		return err
	}
	want, _ := p.Hash()
	got, err := a.Proposal.Hash()
	if err != nil || got != want || a.ExecutionID != run.ID || a.OrganizationID != command.Target.OrganizationID || a.HumanID != run.HumanID || a.GrantID != run.GrantID || a.MembershipID != run.MembershipID || a.BindingID != run.CoordinatorBindingID || a.HostAddress != run.HostAddress || a.HostAddress != command.Target.NodeID || a.InstanceID != command.Target.AgentID || p.ManagedAgentID != run.ManagedAgentID || run.CapabilityID != command.Capability.ID || run.Target != command.Target || run.Signer != command.Signer || run.Action != command.Action || run.Scope != command.Scope || a.Proposal.ReviewExpiresAtMS > run.ExpiresAtMS || a.ObservedAtMS < command.IssuedAtMS {
		return fmt.Errorf("acceptance does not match its exact command and chain Run")
	}
	data, err := command.SigningBytes()
	if err != nil {
		return err
	}
	if run.Fingerprint != hashBytes(data) {
		return fmt.Errorf("review command fingerprint mismatch")
	}
	if err := (Ed25519Verifier{}).Verify(context.Background(), command.Signer, data, command.Signature); err != nil {
		return err
	}
	_, err = a.SigningBytes()
	return err
}

func (a HandoverAcceptance) VerifySignature(ctx context.Context) error {
	data, err := a.SigningBytes()
	if err != nil {
		return err
	}
	return (Ed25519Verifier{}).Verify(ctx, a.HostAddress, data, a.Signature)
}

type moveAgentExecutionIndex struct {
	Executions                 moveTable
	UnsettledControl, Revision uint64
}

// Full typed chain inspection, independent of a Coordinator's inventory and a
// physical idle observation. Missing execution coverage never means zero.
func (s *ChainAuthorityResolver) InspectHandover(ctx context.Context, command NodeCommand, run ChainExecution, p HandoverProposal) (HandoverAuthority, error) {
	fail := func() (HandoverAuthority, error) {
		return HandoverAuthority{}, fmt.Errorf("handover source or authority changed")
	}
	hash, err := p.Hash()
	if err != nil {
		return HandoverAuthority{}, err
	}
	signedProposal, err := ProposalForCommand(command)
	if err != nil {
		return HandoverAuthority{}, err
	}
	signedHash, _ := signedProposal.Hash()
	if signedHash != hash {
		return fail()
	}
	if command.Action != "status" || command.Scope != "observation" || command.Target.AgentID == "" || run.State != 1 || run.ManagedAgentID != p.ManagedAgentID || run.HostAddress != command.Target.NodeID || run.Signer != command.Signer || run.Target != command.Target || run.Action != command.Action || run.Scope != command.Scope {
		return fail()
	}
	signing, err := command.SigningBytes()
	if err != nil {
		return HandoverAuthority{}, err
	}
	if err := (Ed25519Verifier{}).Verify(ctx, command.Signer, signing, command.Signature); err != nil {
		return HandoverAuthority{}, err
	}
	if run.Fingerprint != hashBytes(signing) {
		return fail()
	}
	state, err := s.Resolve(ctx, command.Capability)
	if err != nil {
		return HandoverAuthority{}, err
	}
	if state.Revoked || state.Target != command.Target || state.RevocationVersion != uint64(command.Capability.RevocationVersion) || !slices.Contains(state.AuthorizedSigners, command.Signer) || !slices.Contains(state.Actions, command.Action) || !slices.Contains(state.Scopes, command.Scope) || state.ManagedInstance == nil || state.ManagedInstance.ID != p.ManagedAgentID || state.ManagedInstance.Version != p.ManagedVersion || state.ManagedInstance.Runtime != "bounded-process-v1" || state.ManagedInstance.WorkspaceHash != p.WorkspaceHash {
		return fail()
	}
	r := &chainRead{resolver: s, versions: map[string]uint64{}}
	var org moveOrganization
	var human moveHuman
	var grant moveGrant
	var role moveRole
	var okr moveOkr
	for _, item := range []struct {
		id, kind string
		value    any
	}{{command.Target.OrganizationID, "organization::Organization", &org}, {run.HumanID, "identity::HumanIdentity", &human}, {run.GrantID, "identity::DeviceGrant", &grant}, {p.OkrID, "okr::Okr", &okr}} {
		if err := r.object(ctx, item.id, item.kind, item.value); err != nil {
			return HandoverAuthority{}, err
		}
	}
	if err := r.field(ctx, human.Roles.ID.String(), structKeyTag("0x2", "object", "ID"), org.ID[:], "0x2::object::ID", s.packageID+"::identity::OrgRole", &role); err != nil {
		return HandoverAuthority{}, err
	}
	if !org.Active || !role.Active || !role.Admin || role.Owner != org.Admin || grant.Human != human.ID || grant.Device.String() != command.Signer || grant.Revoked || grant.Generation != human.Generation || !containsAddress(human.Grants, grant.ID) || !containsAddress(human.Organizations, org.ID) || len(grant.Org) > 1 || len(grant.Org) == 1 && grant.Org[0] != org.ID {
		return fail()
	}
	for _, action := range []byte{1, 2, 3, 4} {
		if !containsByte(grant.Actions, action) {
			return fail()
		}
	}
	if okr.Org != org.ID || okr.Version != uint64(p.OkrVersion) || okr.SpecRevision != uint64(p.SpecRevision) || (okr.State != 0 && okr.State != 2) || len(okr.Metrics) < 1 || len(okr.Metrics) > 3 || uint64(p.ExpiresAtMS) > okr.Deadline {
		return fail()
	}
	if okr.State == 2 {
		var budget moveOkrBudget
		if err := r.field(ctx, p.OkrID, structKeyTag(s.okrPackageID, "okr", "BudgetKey"), []byte{0}, s.okrPackageID+"::okr::BudgetKey", s.okrPackageID+"::okr::BudgetState", &budget); err != nil {
			return HandoverAuthority{}, err
		}
		if budget.Reserved != 0 || budget.Spent > uint64(p.BudgetLimit) || budget.Asset != p.BudgetAsset {
			return fail()
		}
	}
	managed, _ := canonicalHandoverID(p.ManagedAgentID)
	var ledger moveAgentExecutionIndex
	if err := r.field(ctx, command.Target.OrganizationID, structKeyTag(s.packageID, "host", "AgentExecutionIndexKey"), managed[:], s.packageID+"::host::AgentExecutionIndexKey", s.packageID+"::host::AgentExecutionIndex", &ledger); err != nil {
		return HandoverAuthority{}, fmt.Errorf("complete execution coverage unavailable: %w", err)
	}
	if ledger.Revision == 0 || ledger.UnsettledControl > ledger.Executions.Size || ledger.UnsettledControl != 0 {
		return fail()
	}
	now, err := s.ChainTime(ctx)
	if err != nil {
		return HandoverAuthority{}, err
	}
	if now <= 0 || command.IssuedAtMS > now || state.ExpiresAtMS <= now || p.ReviewExpiresAtMS <= now || p.ReviewExpiresAtMS-now > 60_000 || p.ReviewExpiresAtMS > run.ExpiresAtMS || p.ReviewExpiresAtMS > state.ExpiresAtMS || p.ExpiresAtMS <= now || uint64(p.ExpiresAtMS) > grant.Expiry {
		return fail()
	}
	current, found, err := s.LookupExecution(ctx, command.Capability.ID, run.Fingerprint)
	if err != nil {
		return HandoverAuthority{}, err
	}
	if !found || current.ID != run.ID || current.State != 1 || current.AttemptID != run.AttemptID || current.Cursor != run.Cursor || current.StopRequested || current.HumanID != run.HumanID || current.GrantID != run.GrantID || current.MembershipID != run.MembershipID || current.CoordinatorBindingID != run.CoordinatorBindingID || current.ManagedAgentID != run.ManagedAgentID || current.HostAddress != run.HostAddress || current.Target != command.Target || current.Signer != command.Signer || current.Action != command.Action || current.Scope != command.Scope || current.ExpiresAtMS != run.ExpiresAtMS {
		return fail()
	}
	reservation := Reservation{CapabilityID: command.Capability.ID, Signer: command.Signer, CommandID: command.CommandID, Nonce: command.Nonce, IdempotencyKey: command.IdempotencyKey, Fingerprint: hashBytes(signing), Budget: command.Budget, Target: command.Target, Action: command.Action, CommandScope: command.Scope, IssuedAtMS: command.IssuedAtMS, ExpiresAtMS: command.ExpiresAtMS}
	if !current.Matches(reservation) {
		return fail()
	}
	if _, err := r.joinPin(ctx); err != nil {
		return HandoverAuthority{}, err
	}
	after, err := s.Resolve(ctx, command.Capability)
	if err != nil {
		return HandoverAuthority{}, err
	}
	if after.AuthorityVersionHash != state.AuthorityVersionHash {
		return fail()
	}
	return HandoverAuthority{ProposalHash: hash, CoverageRevision: Uint64String(ledger.Revision), ClockMS: now}, nil
}
