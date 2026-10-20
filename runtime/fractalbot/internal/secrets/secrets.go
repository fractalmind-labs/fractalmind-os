// Package secrets resolves the named secrets a FractalBot configuration
// references. The configuration only carries names (`secret:<name>`); each
// machine decides where the values live: the OS credential store, one file per
// secret, environment variables, or an external password manager command.
package secrets

import (
	"errors"
	"fmt"
	"regexp"
	"strings"
)

// RefPrefix marks a configuration value as a secret reference.
const RefPrefix = "secret:"

var namePattern = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,62}$`)

// ErrNotFound reports that a store holds no value for a name.
var ErrNotFound = errors.New("secret not set")

// ErrReadOnly reports that a store cannot be written by FractalBot.
var ErrReadOnly = errors.New("store is read-only")

// ValidateName checks a secret name: lower-case letters, digits and hyphens,
// starting with a letter or digit.
func ValidateName(name string) error {
	if !namePattern.MatchString(name) {
		return fmt.Errorf("secret name %q must use lower-case letters, digits and hyphens", name)
	}
	return nil
}

// ParseRef returns the name in a `secret:<name>` reference. It never echoes a
// value that is not a reference, because that value may be a plaintext secret.
func ParseRef(value string) (string, error) {
	if !strings.HasPrefix(value, RefPrefix) {
		return "", errors.New("must be a secret reference (secret:<name>); plaintext values are not accepted")
	}
	name := strings.TrimPrefix(value, RefPrefix)
	if err := ValidateName(name); err != nil {
		return "", err
	}
	return name, nil
}

// Store is one place secret values live.
type Store interface {
	// Kind names the store in diagnostics: os, file, env or command.
	Kind() string
	// Available reports why the store cannot be used on this machine, or nil.
	Available() error
	Get(name string) (string, error)
	Set(name, value string) error
	Delete(name string) error
}

// Config chooses this machine's stores. It is the `secrets` section of the
// configuration.
type Config struct {
	// Store is auto (the default), os, file, env or command.
	Store string `yaml:"store,omitempty"`
	// Namespace is the service name in the OS credential store. Default:
	// fractalbot.
	Namespace string `yaml:"namespace,omitempty"`
	// Command is the default command for store: command. The secret name is
	// passed as the last argument.
	Command []string `yaml:"command,omitempty"`
	// Overrides store individual secrets elsewhere.
	Overrides map[string]Override `yaml:"overrides,omitempty"`
}

// Override stores one secret differently from the default.
type Override struct {
	// Store is os, file or env. Leave it empty when Command is set.
	Store string `yaml:"store,omitempty"`
	// Command prints the value on its first output line. It runs without a
	// shell; the secret name is not appended.
	Command []string `yaml:"command,omitempty"`
}

const defaultNamespace = "fractalbot"

// Validate checks the section without touching any store.
func (c Config) Validate() error {
	switch c.Store {
	case "", "auto", "os", "file", "env":
	case "command":
		if len(c.Command) == 0 {
			return errors.New("secrets.command: required when store is command")
		}
	default:
		return fmt.Errorf("secrets.store: unsupported store %q (use auto, os, file, env or command)", c.Store)
	}
	if c.Store != "command" && len(c.Command) > 0 {
		return errors.New("secrets.command: only used when store is command")
	}
	if c.Namespace != "" && !namePattern.MatchString(c.Namespace) {
		return fmt.Errorf("secrets.namespace: %q must use lower-case letters, digits and hyphens", c.Namespace)
	}
	for name, o := range c.Overrides {
		if err := ValidateName(name); err != nil {
			return fmt.Errorf("secrets.overrides: %w", err)
		}
		switch {
		case len(o.Command) > 0 && o.Store != "":
			return fmt.Errorf("secrets.overrides[%q]: set either store or command", name)
		case len(o.Command) > 0:
		case o.Store == "os" || o.Store == "file" || o.Store == "env":
		default:
			return fmt.Errorf("secrets.overrides[%q]: store must be os, file or env, or set command", name)
		}
	}
	return nil
}
