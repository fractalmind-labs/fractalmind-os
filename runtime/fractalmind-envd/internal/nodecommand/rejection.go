package nodecommand

import (
	"errors"
	"fmt"
)

type RejectionCode string

const (
	CodeInvalidVersion      RejectionCode = "invalid_version"
	CodeInvalidEnvelope     RejectionCode = "invalid_envelope"
	CodePayloadHashMismatch RejectionCode = "payload_hash_mismatch"
	CodeNotYetValid         RejectionCode = "not_yet_valid"
	CodeExpired             RejectionCode = "expired"
	CodeTTLExceeded         RejectionCode = "ttl_exceeded"
	CodeWrongTarget         RejectionCode = "wrong_target"
	CodeWrongScope          RejectionCode = "wrong_scope"
	CodeUnauthorized        RejectionCode = "unauthorized"
	CodeRevoked             RejectionCode = "revoked"
	CodeAuthorityStale      RejectionCode = "authority_stale"
	CodeCapabilityExhausted RejectionCode = "capability_exhausted"
	CodeBudgetExceeded      RejectionCode = "budget_exceeded"
	CodeRiskUnclassified    RejectionCode = "risk_unclassified"
	CodeSignatureInvalid    RejectionCode = "signature_invalid"
	CodeReplay              RejectionCode = "replay"
	CodeIdempotencyConflict RejectionCode = "idempotency_conflict"
)

// RejectionError provides a stable machine-readable result code while keeping
// a human-readable reason for logs and API responses.
type RejectionError struct {
	Code    RejectionCode
	Message string
	Cause   error
}

func (e *RejectionError) Error() string {
	if e.Message == "" {
		return string(e.Code)
	}
	return fmt.Sprintf("%s: %s", e.Code, e.Message)
}

func (e *RejectionError) Unwrap() error { return e.Cause }

func reject(code RejectionCode, message string, cause error) error {
	return &RejectionError{Code: code, Message: message, Cause: cause}
}

func CodeOf(err error) RejectionCode {
	var rejection *RejectionError
	if errors.As(err, &rejection) {
		return rejection.Code
	}
	return ""
}
