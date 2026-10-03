package hostidentity

import (
	"fmt"
	"regexp"
	"runtime"
)

var collectionPattern = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$`)

func secretServiceCollection(platform, name string) (string, error) {
	if name == "" {
		return "fractalmind", nil
	}
	if platform != "linux" || !collectionPattern.MatchString(name) {
		return "", fmt.Errorf("Secret Service collection requires Linux and 1–64 ASCII letters, digits, hyphens or underscores")
	}
	return name, nil
}

// OpenNativeStore preserves the dedicated default collection. Choosing a
// pre-provisioned collection is explicit; unavailable or locked stores never
// fall back to another collection or a plaintext file.
func OpenNativeStore() (Store, error) { return OpenNativeStoreWithCollection("") }

func OpenNativeStoreWithCollection(name string) (Store, error) {
	collection, err := secretServiceCollection(runtime.GOOS, name)
	if err != nil {
		return nil, err
	}
	return openNativeStore(collection)
}
