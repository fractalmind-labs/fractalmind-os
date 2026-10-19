package hostidentity

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestFileStoreRoundTripAndOwnerOnly(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "keys")
	store, err := OpenConfiguredStore("file", "", dir)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = store.Get("host"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("missing identity must be ErrNotFound, got %v", err)
	}
	keys, err := Initialize(context.Background(), store, "host", t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	want, _ := keys.Public("host")
	keys.Close()
	loaded, err := Load(store, "host")
	if err != nil {
		t.Fatal(err)
	}
	got, _ := loaded.Public("host")
	loaded.Close()
	if got.Address != want.Address {
		t.Fatal("file store did not round-trip the Host identity")
	}
	if err = store.Create("host", []byte("other")); !errors.Is(err, ErrAlreadyExists) {
		t.Fatal("an existing identity must never be replaced")
	}
	if runtime.GOOS != "windows" {
		info, _ := os.Stat(filepath.Join(dir, "host.key"))
		if info.Mode().Perm() != 0o600 {
			t.Fatalf("key file mode %v", info.Mode().Perm())
		}
		os.Chmod(filepath.Join(dir, "host.key"), 0o644)
		if _, err = store.Get("host"); err == nil {
			t.Fatal("a key file readable by others must be refused")
		}
		os.Chmod(filepath.Join(dir, "host.key"), 0o600)
	}
	if err = Remove(store, "host"); err != nil {
		t.Fatal(err)
	}
	if _, err = store.Get("host"); !errors.Is(err, ErrNotFound) {
		t.Fatal("removed identity still present")
	}
}

func TestConfiguredStoreRejectsUnsafeInput(t *testing.T) {
	if _, err := OpenConfiguredStore("file", "", "relative/keys"); err == nil {
		t.Fatal("a relative key_dir must be refused")
	}
	if _, err := OpenConfiguredStore("plaintext", "", t.TempDir()); err == nil {
		t.Fatal("an unknown store kind must be refused")
	}
	if _, err := OpenConfiguredStore("file", "", t.TempDir()); err == nil {
		t.Fatal("a key directory readable by others must be refused")
	}
	store, err := OpenConfiguredStore("file", "", filepath.Join(t.TempDir(), "keys"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err = store.Get("../escape"); err == nil {
		t.Fatal("a profile that escapes the key directory must be refused")
	}
}
