package nodecommand

import (
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"fmt"
	"math"
)

type moveEncryptedRecord struct {
	ID, Org                 moveAddress
	Kind                    uint8
	LogicalID               string
	Revision, KeyVersion    uint64
	Previous                []moveAddress
	Human, Device, Grant    moveAddress
	GrantVersion, CreatedMS uint64
	Body                    []byte
}

// ChainExecutionResult contains only authenticated chain metadata and encrypted
// content. A result, including a needs-confirmation result, is not new execution
// permission. The caller must separately obtain an authorized historical key.
type ChainExecutionResult struct {
	ID, OrganizationID, LogicalID string
	TransactionDigest             string
	Revision, KeyVersion          uint64
	EncryptedBody                 []byte
	Execution                     ChainExecution
}

type moveResultKeyGrant struct {
	Org, Membership, Host moveAddress
	KeyVersion            uint64
	WrappedKey            []byte
}
type ChainResultKeyGrant struct {
	OrganizationID, MembershipID, HostAddress string
	KeyVersion                                uint64
	WrappedKey                                []byte
}

func (s *ChainAuthorityResolver) CurrentRecordKeyVersion(ctx context.Context, organizationID string) (uint64, error) {
	r := &chainRead{resolver: s, versions: map[string]uint64{}}
	var org moveOrganization
	if err := r.object(ctx, organizationID, "organization::Organization", &org); err != nil {
		return 0, err
	}
	var index struct {
		KeyVersion uint64
		Records    moveTable
	}
	err := r.field(ctx, organizationID, structKeyTag(s.packageID, "product_record", "IndexBinding"), []byte{0}, s.packageID+"::product_record::IndexBinding", s.packageID+"::product_record::RecordIndex", &index)
	if errors.Is(err, ErrChainObjectNotFound) {
		return 1, nil
	}
	if err != nil {
		return 0, err
	}
	if index.KeyVersion == 0 {
		return 0, fmt.Errorf("invalid organization content generation")
	}
	return index.KeyVersion, nil
}

func (s *ChainAuthorityResolver) ReadResultKey(ctx context.Context, capabilityID, fingerprint string, keyVersion uint64) (ChainResultKeyGrant, error) {
	run, found, err := s.LookupExecution(ctx, capabilityID, fingerprint)
	if err != nil {
		return ChainResultKeyGrant{}, err
	}
	if !found || keyVersion == 0 {
		return ChainResultKeyGrant{}, fmt.Errorf("prepared command and key version are required")
	}
	hash, _ := hex.DecodeString(fingerprint)
	name := appendBCSBytes(nil, hash)
	name = binary.LittleEndian.AppendUint64(name, keyVersion)
	r := &chainRead{resolver: s, versions: map[string]uint64{}}
	var grant moveResultKeyGrant
	if err := r.field(ctx, capabilityID, structKeyTag(s.packageID, "node_execution", "ResultKeyKey"), name, s.packageID+"::node_execution::ResultKeyKey", s.packageID+"::node_execution::ResultKeyGrant", &grant); err != nil {
		return ChainResultKeyGrant{}, err
	}
	if grant.Org.String() != run.Target.OrganizationID || grant.Membership.String() != run.MembershipID || grant.Host.String() != run.HostAddress || grant.KeyVersion != keyVersion || len(grant.WrappedKey) != 132 || string(grant.WrappedKey[:4]) != "FMW1" || string(grant.WrappedKey[68:72]) != "FME1" {
		return ChainResultKeyGrant{}, fmt.Errorf("command result key binding mismatch")
	}
	return ChainResultKeyGrant{OrganizationID: grant.Org.String(), MembershipID: grant.Membership.String(), HostAddress: grant.Host.String(), KeyVersion: keyVersion, WrappedKey: append([]byte(nil), grant.WrappedKey...)}, nil
}

func (s *ChainAuthorityResolver) ReadExecutionResult(ctx context.Context, capabilityID, fingerprint string) (ChainExecutionResult, bool, error) {
	run, found, err := s.LookupExecution(ctx, capabilityID, fingerprint)
	if err != nil || !found {
		return ChainExecutionResult{}, false, err
	}
	if run.ResultRecordID == "" {
		if run.State == 2 || run.State == 3 || run.State == 4 {
			return ChainExecutionResult{}, false, fmt.Errorf("terminal checkpoint is missing its encrypted result")
		}
		return ChainExecutionResult{}, false, nil
	}
	if run.State < 2 {
		return ChainExecutionResult{}, false, fmt.Errorf("nonterminal checkpoint cannot have a result")
	}
	object, err := s.reader.ReadChainObject(ctx, run.ResultRecordID)
	if err != nil {
		return ChainExecutionResult{}, false, err
	}
	expected, err := s.resolveType(ctx, s.packageID+"::product_record::EncryptedRecord")
	if err != nil {
		return ChainExecutionResult{}, false, err
	}
	if object.ID != run.ResultRecordID || object.Type != expected || object.Version == 0 || !object.Immutable || object.Shared || object.OwnerID != "" {
		return ChainExecutionResult{}, false, fmt.Errorf("unexpected execution result source, owner or version")
	}
	var record moveEncryptedRecord
	if err := decodeChainBCS(object.Content, &record); err != nil {
		return ChainExecutionResult{}, false, fmt.Errorf("decode execution result: %w", err)
	}
	if record.ID.String() != object.ID || record.Org.String() != run.Target.OrganizationID || record.Kind != 5 || record.LogicalID != "command-"+fingerprint || record.Revision != 1 || record.KeyVersion == 0 || len(record.Previous) != 0 || record.Human.String() != run.HumanID || record.Device.String() != run.HostAddress || record.Grant.String() != run.GrantID || record.GrantVersion != run.GrantVersion || record.CreatedMS > math.MaxInt64 || int64(record.CreatedMS) != run.UpdatedAtMS {
		return ChainExecutionResult{}, false, fmt.Errorf("execution result metadata mismatch")
	}
	if len(record.Body) < 32 || len(record.Body) > 65536 || (string(record.Body[:4]) != "FME1" && string(record.Body[:4]) != "FME2") {
		return ChainExecutionResult{}, false, fmt.Errorf("invalid encrypted execution result envelope")
	}
	hash := sha256.Sum256(record.Body)
	if hex.EncodeToString(hash[:]) != run.ResultHash {
		return ChainExecutionResult{}, false, fmt.Errorf("execution result hash mismatch")
	}
	if string(record.Body[:4]) == "FME2" {
		if _, err := s.ReadResultKey(ctx, capabilityID, fingerprint, record.KeyVersion); err != nil {
			return ChainExecutionResult{}, false, fmt.Errorf("command result key: %w", err)
		}
	}
	// The result record is immutable, so its last transaction is its creation.
	// The encrypted body was prepared before that transaction's digest existed.
	return ChainExecutionResult{ID: record.ID.String(), OrganizationID: record.Org.String(), LogicalID: record.LogicalID, TransactionDigest: object.PreviousTransaction, Revision: record.Revision, KeyVersion: record.KeyVersion, EncryptedBody: append([]byte(nil), record.Body...), Execution: run}, true, nil
}
