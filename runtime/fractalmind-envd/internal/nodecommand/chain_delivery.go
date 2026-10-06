package nodecommand

import (
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"fmt"
)

type moveHostCommandQueue struct{ Commands moveTable }
type moveQueuedCommandPointer struct {
	Execution, Capability, Membership moveAddress
	IntentHash                        []byte
}
type moveCommandDelivery struct {
	KeyVersion                 uint64
	EncryptedCommand, BodyHash []byte
	QueuedAt                   uint64
}

type ChainCommandDelivery struct {
	Run              ChainExecution
	KeyVersion       uint64
	EncryptedCommand []byte
	QueuedAtMS       uint64
}

// ReadHostCommandQueuePage follows only the organization's canonical Host
// queue. Numeric table names bound each read without a local durable cursor.
// Returning a command is not authority: the executor rechecks every current
// source and the chain begin transaction before touching tools.
func (s *ChainAuthorityResolver) ReadHostCommandQueuePage(ctx context.Context, connection HostConnection, offset uint64, limit uint64) ([]ChainCommandDelivery, uint64, bool, error) {
	if limit == 0 || limit > 64 {
		return nil, offset, false, fmt.Errorf("delivery page must contain 1–64 entries")
	}
	host, err := chainAddress(connection.HostAddress)
	if err != nil || host.String() != connection.HostAddress {
		return nil, offset, false, fmt.Errorf("canonical Host address required")
	}
	r := &chainRead{resolver: s, versions: map[string]uint64{}}
	var queue moveHostCommandQueue
	pkg := s.packageID
	err = r.field(ctx, connection.OrganizationID, structKeyTag(pkg, "node_execution", "HostCommandQueueKey"), host[:], pkg+"::node_execution::HostCommandQueueKey", pkg+"::node_execution::HostCommandQueue", &queue)
	if errors.Is(err, ErrChainObjectNotFound) {
		return nil, 0, false, nil
	}
	if err != nil {
		return nil, offset, false, err
	}
	if offset > queue.Commands.Size {
		return nil, offset, false, fmt.Errorf("delivery cursor exceeds chain directory")
	}
	end := offset + min(limit, queue.Commands.Size-offset)
	rows := make([]ChainCommandDelivery, 0, end-offset)
	for position := offset; position < end; position++ {
		var pointer moveQueuedCommandPointer
		key := make([]byte, 8)
		binary.LittleEndian.PutUint64(key, position)
		if err = r.field(ctx, queue.Commands.ID.String(), []byte{2}, key, "u64", pkg+"::node_execution::QueuedCommandPointer", &pointer); err != nil {
			return nil, offset, false, err
		}
		if len(pointer.IntentHash) != 32 {
			return nil, offset, false, fmt.Errorf("invalid queued intent")
		}
		run, found, readErr := s.LookupExecution(ctx, pointer.Capability.String(), hex.EncodeToString(pointer.IntentHash))
		if readErr != nil {
			return nil, offset, false, readErr
		}
		if !found || run.ID != pointer.Execution.String() || run.MembershipID != pointer.Membership.String() || run.Target.OrganizationID != connection.OrganizationID || run.HostAddress != connection.HostAddress {
			return nil, offset, false, fmt.Errorf("queue pointer disagrees with original Run")
		}
		// A historical membership, running, unknown or terminal checkpoint never
		// becomes a retry. Only original current queued commands can be loaded.
		if run.MembershipID != connection.MembershipID || run.State != 0 || run.StopRequested {
			continue
		}
		var delivery moveCommandDelivery
		if err = r.field(ctx, run.ID, structKeyTag(pkg, "node_execution", "CommandDeliveryKey"), []byte{0}, pkg+"::node_execution::CommandDeliveryKey", pkg+"::node_execution::CommandDelivery", &delivery); err != nil {
			return nil, offset, false, err
		}
		hash := sha256.Sum256(delivery.EncryptedCommand)
		if delivery.KeyVersion == 0 || delivery.QueuedAt == 0 || delivery.QueuedAt < uint64(run.IssuedAtMS)-min(uint64(run.IssuedAtMS), 30000) || delivery.QueuedAt >= uint64(run.ExpiresAtMS) || len(delivery.EncryptedCommand) < 33 || len(delivery.EncryptedCommand) > 65536 || string(delivery.EncryptedCommand[:4]) != "FME3" || !equalBytes(delivery.BodyHash, hash[:]) {
			return nil, offset, false, fmt.Errorf("invalid encrypted command delivery")
		}
		rows = append(rows, ChainCommandDelivery{Run: run, KeyVersion: delivery.KeyVersion, EncryptedCommand: delivery.EncryptedCommand, QueuedAtMS: delivery.QueuedAt})
	}
	if _, err = r.joinPin(ctx); err != nil {
		return nil, offset, false, err
	}
	return rows, end, end < queue.Commands.Size, nil
}
