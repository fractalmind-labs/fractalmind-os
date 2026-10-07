package hostidentity

import (
	"context"
	"crypto/ed25519"
	"encoding/json"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"
)

type memoryStore struct {
	mu      sync.Mutex
	data    []byte
	failure error
	creates int
}

func (s *memoryStore) Get(string) ([]byte, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.failure != nil {
		return nil, s.failure
	}
	if s.data == nil {
		return nil, ErrNotFound
	}
	return append([]byte(nil), s.data...), nil
}
func (s *memoryStore) Create(_ string, data []byte) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.failure != nil {
		return s.failure
	}
	if s.data != nil {
		return ErrAlreadyExists
	}
	s.data = append([]byte(nil), data...)
	s.creates++
	return nil
}
func TestHostIdentityExplicitInitializationAndReload(t *testing.T) {
	store := &memoryStore{}
	if _, err := Load(store, "local"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("load created identity: %v", err)
	}
	keys, err := Initialize(context.Background(), store, "local", t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer keys.Close()
	public, err := keys.Public("local")
	if err != nil {
		t.Fatal(err)
	}
	secret, err := keys.EncryptionSecret(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	clear(secret)
	private, err := keys.SigningPrivate()
	if err != nil {
		t.Fatal(err)
	}
	signature := ed25519.Sign(private, []byte("proof"))
	if !ed25519.Verify(private.Public().(ed25519.PublicKey), []byte("proof"), signature) {
		t.Fatal("invalid signing key")
	}
	clear(private)
	restored, err := Load(store, "local")
	if err != nil {
		t.Fatal(err)
	}
	defer restored.Close()
	next, err := restored.Public("local")
	if err != nil || next != public {
		t.Fatalf("identity changed: %v", err)
	}
	exported, err := json.Marshal(keys)
	if err != nil || string(exported) != "{}" {
		t.Fatal("private keys were serializable")
	}
	if store.creates != 1 {
		t.Fatal("identity regenerated")
	}
	keys.Close()
	if _, err := keys.SigningPrivate(); err == nil {
		t.Fatal("closed key still available")
	}
}
func TestHostIdentityConcurrentInitializationDoesNotReplaceKeys(t *testing.T) {
	store := &memoryStore{}
	dir := t.TempDir()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	result := make(chan Public, 16)
	failure := make(chan error, 16)
	var group sync.WaitGroup
	for range 16 {
		group.Add(1)
		go func() {
			defer group.Done()
			keys, err := Initialize(ctx, store, "concurrent", dir)
			if err != nil {
				failure <- err
				return
			}
			defer keys.Close()
			public, err := keys.Public("concurrent")
			if err != nil {
				failure <- err
				return
			}
			result <- public
		}()
	}
	group.Wait()
	close(result)
	close(failure)
	for err := range failure {
		t.Fatal(err)
	}
	var first Public
	count := 0
	for public := range result {
		if count == 0 {
			first = public
		}
		if public != first {
			t.Fatal("concurrent identities diverged")
		}
		count++
	}
	if count != 16 || store.creates != 1 {
		t.Fatalf("results=%d creates=%d", count, store.creates)
	}
}
func TestHostIdentityLockedStoreAndCorruptionNeverRegenerate(t *testing.T) {
	for _, mode := range []string{"locked", "corrupt"} {
		t.Run(mode, func(t *testing.T) {
			store := &memoryStore{}
			if mode == "locked" {
				store.failure = errors.New("OS keychain locked")
			} else {
				store.data = []byte("corrupt")
			}
			if _, err := Initialize(context.Background(), store, "local", t.TempDir()); err == nil {
				t.Fatal("invalid vault accepted")
			}
			if store.creates != 0 {
				t.Fatal("vault failure generated a replacement identity")
			}
		})
	}
	for _, profile := range []string{"", "../other", "org/name", strings.Repeat("a", 65), "身份"} {
		if _, err := Load(&memoryStore{}, profile); err == nil {
			t.Fatalf("unsafe profile %q", profile)
		}
	}
}

type removableStore struct{ memoryStore }

func (s *removableStore) Delete(string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.failure != nil {
		return s.failure
	}
	if s.data == nil {
		return ErrNotFound
	}
	clear(s.data)
	s.data = nil
	return nil
}
func TestHostIdentityRemovalIsExplicitAndRepeatable(t *testing.T) {
	if err := Remove(&memoryStore{}, "local"); err == nil {
		t.Fatal("store without delete support reported removal")
	}
	store := &removableStore{}
	keys, err := Initialize(context.Background(), store, "local", t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	keys.Close()
	if err := Remove(store, "bad profile"); err == nil {
		t.Fatal("invalid profile accepted")
	}
	for i := 0; i < 2; i++ {
		if err := Remove(store, "local"); err != nil {
			t.Fatalf("removal %d: %v", i, err)
		}
	}
	if _, err := Load(store, "local"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("identity remains: %v", err)
	}
	store.failure = errors.New("locked")
	if err := Remove(store, "local"); err == nil {
		t.Fatal("locked store reported removal")
	}
}
