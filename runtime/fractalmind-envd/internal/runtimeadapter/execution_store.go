package runtimeadapter

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"

	"github.com/fractalmind-ai/fractalmind-envd/internal/nodecommand"
)

const executionRecordVersion = "1"

// ExecutionStore persists completed runtime results so an authorized duplicate
// can return prior evidence after an envd restart without executing twice.
type ExecutionStore interface {
	Load(ctx context.Context, key string) (ExecutionRecord, bool, error)
	Save(ctx context.Context, key string, record ExecutionRecord) error
}

type ExecutionRecord struct {
	Version      string                `json:"version"`
	Response     Response              `json:"response"`
	Event        nodecommand.NodeEvent `json:"event"`
	ErrorCode    string                `json:"error_code,omitempty"`
	ErrorMessage string                `json:"error_message,omitempty"`
}

func recordFromExecution(result execution) ExecutionRecord {
	record := ExecutionRecord{
		Version:  executionRecordVersion,
		Response: result.response,
		Event:    result.event,
	}
	if result.err != nil {
		record.ErrorCode = RunErrorCode(result.err)
		record.ErrorMessage = result.err.Error()
	}
	return record
}

func (r ExecutionRecord) execution() (execution, error) {
	if r.Version != executionRecordVersion {
		return execution{}, fmt.Errorf("unsupported execution record version %q", r.Version)
	}
	result := execution{response: r.Response, event: r.Event}
	if r.ErrorMessage != "" {
		code := r.ErrorCode
		if code == "" {
			code = "internal_error"
		}
		result.err = runError(code, errors.New(r.ErrorMessage))
	}
	return result, nil
}

type memoryExecutionStore struct {
	mu      sync.Mutex
	records map[string]ExecutionRecord
}

func newMemoryExecutionStore() *memoryExecutionStore {
	return &memoryExecutionStore{records: make(map[string]ExecutionRecord)}
}

func (s *memoryExecutionStore) Load(_ context.Context, key string) (ExecutionRecord, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	record, ok := s.records[key]
	if !ok {
		return ExecutionRecord{}, false, nil
	}
	return record, true, nil
}

func (s *memoryExecutionStore) Save(_ context.Context, key string, record ExecutionRecord) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.records[key] = record
	return nil
}

// FileExecutionStore keeps one atomically-replaced record per execution key.
// It is safe for multiple readers and avoids a shared manifest that could lose
// unrelated records when more than one envd process writes concurrently.
type FileExecutionStore struct {
	dir string
}

func NewFileExecutionStore(dir string) (*FileExecutionStore, error) {
	if dir == "" {
		return nil, fmt.Errorf("execution store directory is required")
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, fmt.Errorf("create execution store directory: %w", err)
	}
	return &FileExecutionStore{dir: dir}, nil
}

func (s *FileExecutionStore) Load(ctx context.Context, key string) (ExecutionRecord, bool, error) {
	if err := contextError(ctx); err != nil {
		return ExecutionRecord{}, false, err
	}
	data, err := os.ReadFile(s.path(key))
	if errors.Is(err, os.ErrNotExist) {
		return ExecutionRecord{}, false, nil
	}
	if err != nil {
		return ExecutionRecord{}, false, fmt.Errorf("read execution record: %w", err)
	}
	var record ExecutionRecord
	if err := json.Unmarshal(data, &record); err != nil {
		return ExecutionRecord{}, false, fmt.Errorf("decode execution record: %w", err)
	}
	if _, err := record.execution(); err != nil {
		return ExecutionRecord{}, false, err
	}
	return record, true, nil
}

func (s *FileExecutionStore) Save(ctx context.Context, key string, record ExecutionRecord) error {
	if err := contextError(ctx); err != nil {
		return err
	}
	data, err := json.Marshal(record)
	if err != nil {
		return fmt.Errorf("encode execution record: %w", err)
	}
	tmp, err := os.CreateTemp(s.dir, ".execution-*")
	if err != nil {
		return fmt.Errorf("create temporary execution record: %w", err)
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName)
	if err := tmp.Chmod(0o600); err != nil {
		tmp.Close()
		return fmt.Errorf("chmod temporary execution record: %w", err)
	}
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return fmt.Errorf("write temporary execution record: %w", err)
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return fmt.Errorf("sync temporary execution record: %w", err)
	}
	if err := tmp.Close(); err != nil {
		return fmt.Errorf("close temporary execution record: %w", err)
	}
	if err := os.Rename(tmpName, s.path(key)); err != nil {
		return fmt.Errorf("replace execution record: %w", err)
	}
	return nil
}

func (s *FileExecutionStore) path(key string) string {
	sum := sha256.Sum256([]byte(key))
	return filepath.Join(s.dir, hex.EncodeToString(sum[:])+".json")
}

func contextError(ctx context.Context) error {
	if ctx == nil {
		return nil
	}
	select {
	case <-ctx.Done():
		return ctx.Err()
	default:
		return nil
	}
}
