package main

import (
	"bufio"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalbot/internal/configv2"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalbot/internal/secrets"
	"golang.org/x/term"
)

// v2Platform, v2CheckOptions and v2Stdin are the machine the version 2 commands read; tests replace it.
var (
	v2Platform               = configv2.HostPlatform
	v2CheckOptions           = configv2.HostCheckOptions
	v2Stdin        io.Reader = os.Stdin
)

// isV2Command reports whether args name a command that reads the version 2
// configuration.
func isV2Command(args []string) bool {
	if len(args) == 0 {
		return false
	}
	switch strings.ToLower(strings.TrimSpace(args[0])) {
	case "config", "secret":
		return true
	}
	return false
}

func runV2Command(configFlag string, args []string, out io.Writer) int {
	p := v2Platform()
	path := strings.TrimSpace(configFlag)
	if path == "" {
		path = p.DefaultConfigPath()
	}
	cfg, err := configv2.Load(path, p)
	if err != nil {
		fmt.Fprintf(out, "invalid configuration:\n%v\n", err)
		return 1
	}
	switch strings.ToLower(strings.TrimSpace(args[0])) {
	case "config":
		if len(args) < 2 || args[1] != "check" {
			fmt.Fprintln(out, "usage: fractalbot config check")
			return 1
		}
		rep := configv2.Check(cfg, v2CheckOptions())
		rep.Write(out)
		if !rep.OK() {
			return 1
		}
		return 0
	default:
		return runSecretCommand(cfg, args[1:], out)
	}
}

const secretUsage = "usage: fractalbot secret set <name> [--from-file path] | list | check | rm <name>"

func runSecretCommand(cfg *configv2.Config, args []string, out io.Writer) int {
	if len(args) == 0 {
		fmt.Fprintln(out, secretUsage)
		return 1
	}
	resolver, err := secrets.NewResolver(cfg.Secrets, cfg.DataDir, v2CheckOptions().Secrets)
	if err != nil {
		fmt.Fprintln(out, err)
		return 1
	}
	switch args[0] {
	case "list", "check":
		rep := configv2.Check(cfg, v2CheckOptions())
		store, reason := resolver.Default()
		fmt.Fprintf(out, "Default store: %s (%s)\n", store.Kind(), reason)
		missing := false
		for _, s := range rep.Secrets {
			fmt.Fprintf(out, "%s [%s]: %s, used by %s\n", s.Name, s.Store, s.Status, strings.Join(s.UsedBy, ", "))
			missing = missing || s.Status != "set"
		}
		if args[0] == "check" && missing {
			return 1
		}
		return 0
	case "set":
		fs := flag.NewFlagSet("secret set", flag.ContinueOnError)
		fs.SetOutput(out)
		fromFile := fs.String("from-file", "", "read the value from this file instead of standard input")
		name, rest := splitName(args[1:])
		if err := fs.Parse(rest); err != nil || name == "" {
			fmt.Fprintln(out, secretUsage)
			return 1
		}
		if err := secrets.ValidateName(name); err != nil {
			fmt.Fprintln(out, err)
			return 1
		}
		value, err := readSecretValue(*fromFile, out)
		if err != nil {
			fmt.Fprintln(out, err)
			return 1
		}
		store := resolver.StoreFor(name)
		if err := store.Available(); err != nil {
			fmt.Fprintf(out, "%s store unavailable: %v\n", store.Kind(), err)
			return 1
		}
		if err := store.Set(name, value); err != nil {
			fmt.Fprintf(out, "could not store %s: %v\n", name, err)
			return 1
		}
		fmt.Fprintf(out, "%s stored in the %s store\n", name, store.Kind())
		if !referenced(cfg, name) {
			fmt.Fprintf(out, "note: the configuration does not reference secret:%s\n", name)
		}
		return 0
	case "rm":
		if len(args) != 2 {
			fmt.Fprintln(out, secretUsage)
			return 1
		}
		store := resolver.StoreFor(args[1])
		if err := store.Delete(args[1]); err != nil {
			fmt.Fprintf(out, "could not remove %s: %v\n", args[1], err)
			return 1
		}
		fmt.Fprintf(out, "%s removed from the %s store\n", args[1], store.Kind())
		return 0
	default:
		fmt.Fprintln(out, secretUsage)
		return 1
	}
}

// splitName takes the first non-flag argument as the secret name, so the
// name may come before or after --from-file.
func splitName(args []string) (string, []string) {
	var rest []string
	name := ""
	for i := 0; i < len(args); i++ {
		a := args[i]
		switch {
		case strings.HasPrefix(a, "-"):
			rest = append(rest, a)
			if !strings.Contains(a, "=") && i+1 < len(args) {
				i++
				rest = append(rest, args[i])
			}
		case name == "":
			name = a
		default:
			rest = append(rest, a)
		}
	}
	return name, rest
}

// readSecretValue reads one value from a file or standard input, hiding the
// input on a terminal. The value never appears in arguments or history.
func readSecretValue(fromFile string, out io.Writer) (string, error) {
	var raw string
	switch {
	case fromFile != "":
		data, err := os.ReadFile(fromFile)
		if err != nil {
			return "", err
		}
		raw = string(data)
	case isTerminal(v2Stdin):
		fmt.Fprint(out, "Value (input hidden): ")
		data, err := term.ReadPassword(int(v2Stdin.(*os.File).Fd()))
		fmt.Fprintln(out)
		if err != nil {
			return "", err
		}
		raw = string(data)
	default:
		line, err := bufio.NewReader(v2Stdin).ReadString('\n')
		if err != nil && !errors.Is(err, io.EOF) {
			return "", err
		}
		raw = line
	}
	value := strings.TrimRight(raw, "\r\n")
	if strings.TrimSpace(value) == "" {
		return "", errors.New("empty value; nothing stored")
	}
	return value, nil
}

func isTerminal(r io.Reader) bool {
	f, ok := r.(*os.File)
	return ok && term.IsTerminal(int(f.Fd()))
}

func referenced(cfg *configv2.Config, name string) bool {
	for _, n := range cfg.SecretNames() {
		if n == name {
			return true
		}
	}
	return false
}
