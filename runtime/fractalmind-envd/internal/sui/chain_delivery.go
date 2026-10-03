package sui

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"time"

	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/nodecommand"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/productcrypto"
)

// OpenCommandDelivery decrypts only the original command-specific envelope.
// It never exposes an organization key, executes, spends gas or restores an
// unknown checkpoint to queued. Executor.Execute performs current authority.
func (s *ChainExecutionStore) OpenCommandDelivery(ctx context.Context, delivery nodecommand.ChainCommandDelivery) (nodecommand.NodeCommand, error) {
	var command nodecommand.NodeCommand
	run := delivery.Run
	if run.State != 0 || run.StopRequested || run.HostAddress != s.signer.Address() || time.Now().UnixMilli() >= run.ExpiresAtMS {
		return command, fmt.Errorf("delivery is not a live queued command for this Host")
	}
	key, err := s.resultKey(ctx, run, delivery.KeyVersion)
	if err != nil {
		return command, err
	}
	defer clear(key)
	domain, err := productcrypto.CommandDeliveryContext(run.Target.OrganizationID, run.CapabilityID, run.MembershipID, run.Fingerprint, delivery.KeyVersion)
	if err != nil {
		return command, err
	}
	plaintext, err := productcrypto.DecryptCommandDelivery(delivery.EncryptedCommand, key, domain)
	if err != nil {
		return command, err
	}
	defer clear(plaintext)
	decoder := json.NewDecoder(bytes.NewReader(plaintext))
	decoder.DisallowUnknownFields()
	if err = decoder.Decode(&command); err != nil {
		return command, fmt.Errorf("invalid delivered command")
	}
	if err = decoder.Decode(new(any)); err != io.EOF {
		return command, fmt.Errorf("trailing delivered command data")
	}
	reservation, err := commandReservation(command)
	if err != nil || !run.Matches(reservation) {
		return command, fmt.Errorf("decrypted delivery does not match the original Run")
	}
	data, err := command.SigningBytes()
	if err != nil || nodecommand.HashPayload(command.Payload) != command.PayloadHash {
		return command, fmt.Errorf("invalid delivered payload")
	}
	if err = (nodecommand.Ed25519Verifier{}).Verify(ctx, command.Signer, data, command.Signature); err != nil {
		return command, fmt.Errorf("invalid delivered command signature")
	}
	current, _, err := s.lookup(ctx, command)
	if err != nil {
		return command, err
	}
	if current.State != 0 || current.StopRequested || current.ID != run.ID || current.MembershipID != run.MembershipID || current.ExpiresAtMS != run.ExpiresAtMS {
		return command, fmt.Errorf("original delivery checkpoint changed")
	}
	return command, nil
}
