package nodecommand

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
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
	Revision, KeyVersion          uint64
	EncryptedBody                 []byte
	Execution                     ChainExecution
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
	if object.ID != run.ResultRecordID || object.Type != s.packageID+"::product_record::EncryptedRecord" || object.Version == 0 || !object.Immutable || object.Shared || object.OwnerID != "" {
		return ChainExecutionResult{}, false, fmt.Errorf("unexpected execution result source, owner or version")
	}
	var record moveEncryptedRecord
	if err := decodeChainBCS(object.Content, &record); err != nil {
		return ChainExecutionResult{}, false, fmt.Errorf("decode execution result: %w", err)
	}
	if record.ID.String() != object.ID || record.Org.String() != run.Target.OrganizationID || record.Kind != 5 || record.LogicalID != "command-"+fingerprint || record.Revision != 1 || record.KeyVersion == 0 || len(record.Previous) != 0 || record.Human.String() != run.HumanID || record.Device.String() != run.HostAddress || record.Grant.String() != run.GrantID || record.GrantVersion != run.GrantVersion || record.CreatedMS > math.MaxInt64 || int64(record.CreatedMS) != run.UpdatedAtMS {
		return ChainExecutionResult{}, false, fmt.Errorf("execution result metadata mismatch")
	}
	if len(record.Body) < 32 || len(record.Body) > 65536 || string(record.Body[:4]) != "FME1" {
		return ChainExecutionResult{}, false, fmt.Errorf("invalid encrypted execution result envelope")
	}
	hash := sha256.Sum256(record.Body)
	if hex.EncodeToString(hash[:]) != run.ResultHash {
		return ChainExecutionResult{}, false, fmt.Errorf("execution result hash mismatch")
	}
	return ChainExecutionResult{ID: record.ID.String(), OrganizationID: record.Org.String(), LogicalID: record.LogicalID, Revision: record.Revision, KeyVersion: record.KeyVersion, EncryptedBody: append([]byte(nil), record.Body...), Execution: run}, true, nil
}
