package secrets

import (
	"bufio"
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/zalando/go-keyring"
)

// osStore keeps values in the OS credential store: the macOS keychain, the
// Windows Credential Manager or the Linux Secret Service. Entries are service
// = namespace, account = secret name, so they are visible in the system tools.
//
// On macOS the values are written and read through /usr/bin/security, so the
// keychain items trust that tool rather than a particular FractalBot build and
// upgrades do not ask for keychain access again.
type osStore struct {
	namespace string
}

func (s osStore) Kind() string { return "os" }

func (s osStore) Available() error {
	if runtime.GOOS == "linux" && os.Getenv("DBUS_SESSION_BUS_ADDRESS") == "" {
		return errors.New("no Secret Service: the session bus is not available (use store: file or env)")
	}
	return nil
}

func (s osStore) Get(name string) (string, error) {
	value, err := keyring.Get(s.namespace, name)
	if errors.Is(err, keyring.ErrNotFound) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", fmt.Errorf("read the credential store: %w", err)
	}
	return value, nil
}

func (s osStore) Set(name, value string) error {
	if err := keyring.Set(s.namespace, name, value); err != nil {
		return fmt.Errorf("write the credential store: %w", err)
	}
	return nil
}

func (s osStore) Delete(name string) error {
	err := keyring.Delete(s.namespace, name)
	if errors.Is(err, keyring.ErrNotFound) {
		return ErrNotFound
	}
	return err
}

// fileStore keeps one owner-only file per secret under dir.
type fileStore struct {
	dir string
}

func (s fileStore) Kind() string { return "file" }

func (s fileStore) Available() error { return nil }

func (s fileStore) path(name string) string { return filepath.Join(s.dir, name) }

func (s fileStore) Get(name string) (string, error) {
	path := s.path(name)
	info, err := os.Stat(path)
	if errors.Is(err, os.ErrNotExist) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", err
	}
	if err := checkOwnerOnly(s.dir, true); err != nil {
		return "", err
	}
	if err := checkOwnerOnly(path, false); err != nil {
		return "", err
	}
	if !info.Mode().IsRegular() {
		return "", fmt.Errorf("%s is not a regular file", path)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	value := strings.TrimRight(string(data), "\r\n")
	if value == "" {
		return "", ErrNotFound
	}
	return value, nil
}

func (s fileStore) Set(name, value string) error {
	if err := os.MkdirAll(s.dir, 0o700); err != nil {
		return err
	}
	if err := os.Chmod(s.dir, 0o700); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(s.dir, "."+name+".*")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	if err := tmp.Chmod(0o600); err != nil {
		tmp.Close()
		return err
	}
	if _, err := tmp.WriteString(value + "\n"); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmp.Name(), s.path(name))
}

func (s fileStore) Delete(name string) error {
	err := os.Remove(s.path(name))
	if errors.Is(err, os.ErrNotExist) {
		return ErrNotFound
	}
	return err
}

// envStore reads FRACTALBOT_SECRET_<NAME>, with hyphens as underscores and
// the name upper-cased. Values are set in the service manager, not by
// FractalBot.
type envStore struct {
	lookup func(string) (string, bool)
}

// EnvVar returns the environment variable that holds name.
func EnvVar(name string) string {
	return "FRACTALBOT_SECRET_" + strings.ToUpper(strings.ReplaceAll(name, "-", "_"))
}

func (s envStore) Kind() string { return "env" }

func (s envStore) Available() error { return nil }

func (s envStore) Get(name string) (string, error) {
	value, ok := s.lookup(EnvVar(name))
	if !ok || value == "" {
		return "", ErrNotFound
	}
	return value, nil
}

func (s envStore) Set(string, string) error {
	return fmt.Errorf("%w: set the environment variable in the service definition instead", ErrReadOnly)
}

func (s envStore) Delete(string) error { return s.Set("", "") }

// commandStore asks an external password manager. The command runs without a
// shell, has five seconds, and only the first line of its output is used; its
// error output is never recorded because it may echo the value.
type commandStore struct {
	argv []string
	// appendName passes the secret name as the last argument (the store-wide
	// command); a per-secret override names its item itself.
	appendName bool
	timeout    time.Duration
}

func (s commandStore) Kind() string { return "command" }

func (s commandStore) Available() error {
	if _, err := exec.LookPath(s.argv[0]); err != nil {
		return fmt.Errorf("command %q not found", s.argv[0])
	}
	return nil
}

func (s commandStore) Get(name string) (string, error) {
	timeout := s.timeout
	if timeout <= 0 {
		timeout = 5 * time.Second
	}
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	args := append([]string(nil), s.argv[1:]...)
	if s.appendName {
		args = append(args, name)
	}
	cmd := exec.CommandContext(ctx, s.argv[0], args...)
	var stdout bytes.Buffer
	cmd.Stdout = &stdout
	if err := cmd.Run(); err != nil {
		if ctx.Err() != nil {
			return "", fmt.Errorf("command %q timed out", s.argv[0])
		}
		var exit *exec.ExitError
		if errors.As(err, &exit) {
			return "", fmt.Errorf("command %q failed with exit code %d", s.argv[0], exit.ExitCode())
		}
		return "", fmt.Errorf("command %q could not run", s.argv[0])
	}
	line, _, _ := bufio.NewReader(&stdout).ReadLine()
	value := strings.TrimSpace(string(line))
	if value == "" {
		return "", ErrNotFound
	}
	return value, nil
}

func (s commandStore) Set(string, string) error {
	return fmt.Errorf("%w: store the value in the password manager instead", ErrReadOnly)
}

func (s commandStore) Delete(string) error { return s.Set("", "") }
