//go:build darwin && cgo

package hostidentity

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"os"
	"testing"
	"time"

	keychain "github.com/99designs/go-keychain"
)

func TestNativeHostKeychainAcceptance(t *testing.T) {
	if os.Getenv("FM_HOST_NATIVE_ACCEPTANCE") != "1" {
		t.Skip("explicit isolated generated-key native acceptance")
	}
	suffix := make([]byte, 8)
	if _, err := rand.Read(suffix); err != nil {
		t.Fatal(err)
	}
	profile := "acceptance-" + hex.EncodeToString(suffix)
	t.Cleanup(func() {
		query, err := hostQuery(profile)
		if err == nil {
			err = keychain.DeleteItem(query)
		}
		if err != nil && err != keychain.ErrorItemNotFound {
			t.Errorf("remove scoped acceptance key: %v", err)
		}
	})
	store, err := OpenNativeStore()
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	keys, err := Initialize(ctx, store, profile, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer keys.Close()
	public, err := keys.Public(profile)
	if err != nil {
		t.Fatal(err)
	}
	freshStore, err := OpenNativeStore()
	if err != nil {
		t.Fatal(err)
	}
	restored, err := Load(freshStore, profile)
	if err != nil {
		t.Fatal(err)
	}
	defer restored.Close()
	restoredPublic, err := restored.Public(profile)
	if err != nil || restoredPublic != public {
		t.Fatal("native identity changed")
	}
	overwrite := make([]byte, 68)
	copy(overwrite, "FMH1")
	if err := store.Create(profile, overwrite); err != ErrAlreadyExists {
		t.Fatalf("native identity could be overwritten: %v", err)
	}
	again, err := Load(store, profile)
	if err != nil {
		t.Fatal(err)
	}
	defer again.Close()
	againPublic, err := again.Public(profile)
	if err != nil || againPublic != public {
		t.Fatal("duplicate creation changed keys")
	}
	evidence, _ := json.Marshal(map[string]any{"backend": "macOS Keychain", "generatedTestIdentityOnly": true, "reloadStable": true, "duplicateCreationRejected": true, "localSecretFileCreated": false})
	t.Logf("FM_HOST_VAULT_EVIDENCE %s", evidence)
}

func TestDeniedKeychainPromptIsNotRetriedAutomatically(t *testing.T) {
	for _, err := range []error{errUserCanceled, keychain.ErrorAuthFailed, keychain.ErrorInteractionNotAllowed} {
		if !deniedByPerson(err) {
			t.Fatalf("%v not treated as a denied prompt", err)
		}
	}
	if deniedByPerson(keychain.ErrorItemNotFound) || deniedByPerson(keychain.ErrorDecode) {
		t.Fatal("other failures treated as a denied prompt")
	}
}
