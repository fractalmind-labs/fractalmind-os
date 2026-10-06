package hostidentity

import (
	"strings"
	"testing"
)

func TestSecretServiceCollectionSelection(t *testing.T) {
	for _, platform := range []string{"linux", "darwin", "windows"} {
		got, err := secretServiceCollection(platform, "")
		if err != nil || got != "fractalmind" {
			t.Fatalf("default changed on %s: %q %v", platform, got, err)
		}
	}
	for _, name := range []string{"login", "fractalmind", "test_collection-1"} {
		got, err := secretServiceCollection("linux", name)
		if err != nil || got != name {
			t.Fatalf("explicit Linux collection changed: %q %v", got, err)
		}
	}
	for _, name := range []string{"../login", "/login", "login ", "a/b", "登录", strings.Repeat("a", 65)} {
		if _, err := secretServiceCollection("linux", name); err == nil {
			t.Fatalf("unsafe collection accepted: %q", name)
		}
	}
	for _, platform := range []string{"darwin", "windows"} {
		if _, err := secretServiceCollection(platform, "login"); err == nil {
			t.Fatalf("Linux-only selection ignored on %s", platform)
		}
	}
}
