package secrets

import (
	"bytes"
	"errors"
	"log"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func testEnv(goos string, vars map[string]string, files ...string) Environment {
	return Environment{
		GOOS: goos,
		LookupEnv: func(k string) (string, bool) {
			v, ok := vars[k]
			return v, ok
		},
		Exists: func(p string) bool {
			for _, f := range files {
				if f == p {
					return true
				}
			}
			return false
		},
	}
}

func TestParseRefNeverEchoesPlaintext(t *testing.T) {
	if name, err := ParseRef("secret:feishu-xiaoyi"); err != nil || name != "feishu-xiaoyi" {
		t.Fatalf("ParseRef: %q %v", name, err)
	}
	for _, bad := range []string{"hunter2-plaintext", "secret:Upper", "secret:", "secret:-x"} {
		_, err := ParseRef(bad)
		if err == nil {
			t.Fatalf("%q: expected error", bad)
		}
		if bad == "hunter2-plaintext" && strings.Contains(err.Error(), bad) {
			t.Fatalf("error echoes the plaintext value: %v", err)
		}
	}
}

func TestConfigValidate(t *testing.T) {
	for _, tc := range []struct {
		cfg  Config
		want string
	}{
		{Config{}, ""},
		{Config{Store: "keychain"}, "unsupported store"},
		{Config{Store: "command"}, "required when store is command"},
		{Config{Store: "file", Command: []string{"op"}}, "only used when store is command"},
		{Config{Overrides: map[string]Override{"a": {Store: "os", Command: []string{"op"}}}}, "either store or command"},
		{Config{Overrides: map[string]Override{"a": {Store: "vault"}}}, "store must be os, file or env"},
		{Config{Overrides: map[string]Override{"A": {Store: "env"}}}, "lower-case"},
	} {
		err := tc.cfg.Validate()
		if tc.want == "" && err != nil || tc.want != "" && (err == nil || !strings.Contains(err.Error(), tc.want)) {
			t.Fatalf("%+v: want %q, got %v", tc.cfg, tc.want, err)
		}
	}
}

func TestAutoStoreSelection(t *testing.T) {
	for _, tc := range []struct {
		env  Environment
		want string
	}{
		{testEnv("darwin", nil), "os"},
		{testEnv("windows", nil), "os"},
		{testEnv("linux", map[string]string{"DBUS_SESSION_BUS_ADDRESS": "unix:path=/run/user/1000/bus"}), "os"},
		{testEnv("linux", nil), "file"},
		{testEnv("linux", nil, "/.dockerenv"), "env"},
		{testEnv("darwin", map[string]string{"KUBERNETES_SERVICE_HOST": "10.0.0.1"}), "env"},
	} {
		r, err := NewResolver(Config{}, t.TempDir(), tc.env)
		if err != nil {
			t.Fatal(err)
		}
		if got, _ := r.Default(); got.Kind() != tc.want {
			t.Fatalf("%s: want %s, got %s", tc.env.GOOS, tc.want, got.Kind())
		}
	}
}

func TestFileStoreRoundTripAndPermissions(t *testing.T) {
	dataDir := t.TempDir()
	r, err := NewResolver(Config{Store: "file"}, dataDir, testEnv(runtime.GOOS, nil))
	if err != nil {
		t.Fatal(err)
	}
	store := r.StoreFor("telegram-main")
	if _, err := store.Get("telegram-main"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected not found, got %v", err)
	}
	if err := store.Set("telegram-main", "value-one"); err != nil {
		t.Fatal(err)
	}
	if got, err := store.Get("telegram-main"); err != nil || got != "value-one" {
		t.Fatalf("Get: %q %v", got, err)
	}
	path := filepath.Join(dataDir, "secrets", "telegram-main")
	if runtime.GOOS != "windows" {
		info, _ := os.Stat(path)
		if info.Mode().Perm() != 0o600 {
			t.Fatalf("file mode %v", info.Mode().Perm())
		}
		if err := os.Chmod(path, 0o644); err != nil {
			t.Fatal(err)
		}
		if _, err := store.Get("telegram-main"); err == nil || !strings.Contains(err.Error(), "mode") {
			t.Fatalf("expected a permission error, got %v", err)
		}
		os.Chmod(path, 0o600)
	}
	if err := store.Delete("telegram-main"); err != nil {
		t.Fatal(err)
	}
	if err := store.Delete("telegram-main"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("second delete: %v", err)
	}
}

func TestEnvStoreAndOverrides(t *testing.T) {
	env := testEnv("darwin", map[string]string{"FRACTALBOT_SECRET_FEISHU_XIAOYI": "from-env"})
	r, err := NewResolver(Config{Store: "env", Overrides: map[string]Override{"telegram-main": {Store: "file"}}}, t.TempDir(), env)
	if err != nil {
		t.Fatal(err)
	}
	results := r.Resolve([]string{"telegram-main", "feishu-xiaoyi", "feishu-xiaoyi"})
	if len(results) != 2 {
		t.Fatalf("expected de-duplicated results, got %+v", results)
	}
	if results[0].Name != "feishu-xiaoyi" || results[0].Value != "from-env" || results[0].Store != "env" {
		t.Fatalf("env result: %+v", results[0])
	}
	if results[1].Store != "file" || !results[1].Missing() {
		t.Fatalf("override result: %+v", results[1])
	}
	if err := r.StoreFor("feishu-xiaoyi").Set("feishu-xiaoyi", "x"); !errors.Is(err, ErrReadOnly) {
		t.Fatalf("env store must be read-only, got %v", err)
	}
}

func TestCommandStore(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("uses a POSIX shell script")
	}
	dir := t.TempDir()
	script := filepath.Join(dir, "pm")
	body := "#!/bin/sh\nif [ \"$1\" = fail ]; then echo leaked-value >&2; exit 3; fi\nprintf 'first-%s\\nsecond\\n' \"$1\"\n"
	if err := os.WriteFile(script, []byte(body), 0o700); err != nil {
		t.Fatal(err)
	}
	r, err := NewResolver(Config{Store: "command", Command: []string{script}, Overrides: map[string]Override{
		"fixed": {Command: []string{script, "item"}},
	}}, dir, testEnv("darwin", nil))
	if err != nil {
		t.Fatal(err)
	}
	res := r.Resolve([]string{"telegram-main", "fixed", "fail"})
	if res[2].Value != "first-telegram-main" || res[1].Value != "first-item" {
		t.Fatalf("command results: %+v", res)
	}
	if res[0].Err == nil || strings.Contains(res[0].Err.Error(), "leaked-value") || !strings.Contains(res[0].Err.Error(), "exit code 3") {
		t.Fatalf("command failure must report only the exit code: %v", res[0].Err)
	}
}

func TestRedactor(t *testing.T) {
	r := NewRedactor()
	r.Add("feishu-xiaoyi", "abcdefghijklmnop")
	r.Add("short", "abc")
	var buf bytes.Buffer
	logger := log.New(r.Writer(&buf), "", 0)
	logger.Printf("auth failed for abcdefghijklmnop; GET https://api.telegram.org/bot1234567890:AAH-abcdefghijklmnopqrstuvwxyz012345/getUpdates abc")
	got := buf.String()
	if strings.Contains(got, "abcdefghijklmnop") || strings.Contains(got, "AAH-abc") {
		t.Fatalf("secret leaked: %s", got)
	}
	if !strings.Contains(got, "[secret:feishu-xiaoyi]") || !strings.Contains(got, "bot[redacted]") || !strings.HasSuffix(strings.TrimSpace(got), "abc") {
		t.Fatalf("unexpected redaction: %s", got)
	}
}

func TestRedactorMasksURLCredentials(t *testing.T) {
	got := NewRedactor().Redact("connected to wss://msg-frontier.feishu.cn/ws/v2?fpid=493&access_key=c7c9371af34e1adf47bd05bed627e020&service_id=1&ticket=0f3a9c2e-1b2d")
	if strings.Contains(got, "c7c9371af34e1adf") || strings.Contains(got, "0f3a9c2e") || !strings.Contains(got, "fpid=493") {
		t.Fatalf("redacted: %s", got)
	}
}
