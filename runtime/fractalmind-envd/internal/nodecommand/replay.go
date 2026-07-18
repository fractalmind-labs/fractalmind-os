package nodecommand

import "sync"

// ReplayGuard records accepted command identities before execution. A durable
// implementation can replace this in-memory Phase 0 implementation.
type ReplayGuard interface {
	CheckAndRecord(commandID, nonce, idempotencyKey, fingerprint string) (duplicate bool, err error)
}

type MemoryReplayGuard struct {
	mu             sync.Mutex
	commands       map[string]string
	nonces         map[string]string
	idempotencyKey map[string]string
}

func NewMemoryReplayGuard() *MemoryReplayGuard {
	return &MemoryReplayGuard{
		commands:       make(map[string]string),
		nonces:         make(map[string]string),
		idempotencyKey: make(map[string]string),
	}
}

func (g *MemoryReplayGuard) CheckAndRecord(commandID, nonce, idempotencyKey, fingerprint string) (bool, error) {
	g.mu.Lock()
	defer g.mu.Unlock()

	if previous, ok := g.commands[commandID]; ok {
		if previous == fingerprint {
			return true, nil
		}
		return false, reject(CodeReplay, "command_id was reused with different content", nil)
	}
	if previous, ok := g.idempotencyKey[idempotencyKey]; ok {
		if previous == fingerprint {
			return true, nil
		}
		return false, reject(CodeIdempotencyConflict, "idempotency_key was reused with different content", nil)
	}
	if _, ok := g.nonces[nonce]; ok {
		return false, reject(CodeReplay, "nonce was already used", nil)
	}

	g.commands[commandID] = fingerprint
	g.nonces[nonce] = commandID
	g.idempotencyKey[idempotencyKey] = fingerprint
	return false, nil
}
