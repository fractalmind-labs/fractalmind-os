package main

import (
	"bufio"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"time"

	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/config"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/hostidentity"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/hostjoin"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/nodecommand"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/sui"
	"golang.org/x/term"
)

// hostJoinAccessPrefix marks the App's Host access string: the public
// connection configuration plus the one-use invitation, encoded together so a
// new Host needs one paste. The whole string is a bearer secret.
const hostJoinAccessPrefix = "FMJ1:"

const maxHostJoinAccess = 4096

var (
	accessObjectID = regexp.MustCompile("^0x[0-9a-f]{64}$")
	base58ChainID  = regexp.MustCompile("^[1-9A-HJ-NP-Za-km-z]{32,44}$")
)

type hostJoinAccess struct {
	Version                   int    `json:"v"`
	Network                   string `json:"network"`
	RPC                       string `json:"rpc"`
	GraphQLURL                string `json:"graphql_url,omitempty"`
	ChainIdentifier           string `json:"chain_identifier"`
	ProtocolPackageID         string `json:"protocol_package_id"`
	ProtocolOriginalPackageID string `json:"protocol_original_package_id"`
	OkrPackageID              string `json:"okr_package_id"`
	OkrOriginalPackageID      string `json:"okr_original_package_id"`
	DirectPackageID           string `json:"direct_package_id"`
	DirectOriginalPackageID   string `json:"direct_original_package_id"`
	ProtocolRegistryID        string `json:"protocol_registry_id"`
	OrgID                     string `json:"org_id"`
	HostJoinGasBudget         uint64 `json:"host_join_gas_budget"`
	Invite                    string `json:"invite"`
}

// parseHostJoinAccess validates the public fields and the embedded invitation.
// The returned invitation bytes must be cleared by the caller.
func parseHostJoinAccess(raw []byte) (hostJoinAccess, []byte, error) {
	var access hostJoinAccess
	invalid := errors.New("invalid Host access string; copy it again from the FractalMind App")
	text := bytes.TrimSpace(raw)
	if len(text) > maxHostJoinAccess || !bytes.HasPrefix(text, []byte(hostJoinAccessPrefix)) {
		return access, nil, invalid
	}
	payload, err := base64.RawURLEncoding.DecodeString(string(text[len(hostJoinAccessPrefix):]))
	if err != nil {
		return access, nil, invalid
	}
	defer clear(payload)
	decoder := json.NewDecoder(bytes.NewReader(payload))
	decoder.DisallowUnknownFields()
	if err = decoder.Decode(&access); err != nil || decoder.More() {
		return hostJoinAccess{}, nil, invalid
	}
	invite := []byte(access.Invite)
	access.Invite = ""
	ids := []string{access.ProtocolPackageID, access.ProtocolOriginalPackageID, access.OkrPackageID, access.OkrOriginalPackageID, access.DirectPackageID, access.DirectOriginalPackageID, access.ProtocolRegistryID, access.OrgID}
	valid := access.Version == 1 && base58ChainID.MatchString(access.ChainIdentifier) && access.HostJoinGasBudget > 0 && access.HostJoinGasBudget <= 1_000_000_000 &&
		validEndpoint(access.RPC) && (access.GraphQLURL == "" || validEndpoint(access.GraphQLURL))
	for _, id := range ids {
		valid = valid && accessObjectID.MatchString(id)
	}
	if !valid {
		clear(invite)
		return hostJoinAccess{}, nil, invalid
	}
	// The invitation names its own network; it must match the configuration.
	parsed, err := nodecommand.ParseHostInvitation(invite, access.Network)
	if err != nil {
		clear(invite)
		return hostJoinAccess{}, nil, invalid
	}
	parsed.Close()
	return access, invite, nil
}

func validEndpoint(value string) bool {
	return len(value) <= 256 && (strings.HasPrefix(value, "https://") || strings.HasPrefix(value, "http://127.0.0.1:") || strings.HasPrefix(value, "http://localhost:")) && !strings.ContainsAny(value, " \"'\\\n\r\t")
}

// hostJoinFingerprint lets the operator compare the organization and
// Coordinator entry the Host verified on chain with what the App shows,
// without copying a 64-character ID. The App computes the same value.
func hostJoinFingerprint(organization, binding string) string {
	sum := sha256.Sum256([]byte("fractalmind.host-join-fingerprint.v1\n" + organization + "\n" + binding))
	const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ" // Crockford base32
	var bits uint64
	for _, b := range sum[:5] {
		bits = bits<<8 | uint64(b)
	}
	out := make([]byte, 8)
	for i := 7; i >= 0; i-- {
		out[i] = alphabet[bits&31]
		bits >>= 5
	}
	return string(out[:4]) + "-" + string(out[4:])
}

func defaultHostConfigPath() string {
	if runtime.GOOS == "windows" {
		if dir, err := os.UserConfigDir(); err == nil {
			return filepath.Join(dir, "fractalmind-envd", "sentinel.yaml")
		}
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "sentinel.yaml"
	}
	return filepath.Join(home, ".config", "fractalmind-envd", "sentinel.yaml")
}

// hostJoinConfig is an observation-only worker: no execution adapter, no
// remote shell and no automatic restart of local agents.
func hostJoinConfig(access hostJoinAccess, profile, name, keyStore, keyDir string) []byte {
	q := func(s string) string { encoded, _ := json.Marshal(s); return string(encoded) }
	var b strings.Builder
	b.WriteString("# Written by `fractalmind-envd join` from the FractalMind App's Host access string.\n")
	b.WriteString("# Public configuration only: Host keys stay in the system credential store.\n")
	fmt.Fprintf(&b, "identity:\n  key_profile: %s\n  hostname: %s\n", q(profile), q(name))
	if keyStore == "file" {
		fmt.Fprintf(&b, "  key_store: \"file\"\n  key_dir: %s\n", q(keyDir))
	}
	b.WriteString("roles:\n  coordinator: false\n  sponsor: false\n  relay: false\n  stun_server: false\n")
	fmt.Fprintf(&b, "sui:\n  enabled: true\n  host_connection_enabled: true\n  network: %s\n  rpc: %s\n", q(access.Network), q(access.RPC))
	if access.GraphQLURL != "" {
		fmt.Fprintf(&b, "  graphql_url: %s\n", q(access.GraphQLURL))
	}
	fmt.Fprintf(&b, "  chain_identifier: %s\n", q(access.ChainIdentifier))
	for _, field := range [][2]string{
		{"protocol_package_id", access.ProtocolPackageID}, {"protocol_original_package_id", access.ProtocolOriginalPackageID},
		{"okr_package_id", access.OkrPackageID}, {"okr_original_package_id", access.OkrOriginalPackageID},
		{"direct_package_id", access.DirectPackageID}, {"direct_original_package_id", access.DirectOriginalPackageID},
		{"protocol_registry_id", access.ProtocolRegistryID}, {"org_id", access.OrgID},
	} {
		fmt.Fprintf(&b, "  %s: %s\n", field[0], q(field[1]))
	}
	fmt.Fprintf(&b, "  host_join_gas_budget: %d\n", access.HostJoinGasBudget)
	b.WriteString("runtime:\n  enabled: false\n")
	b.WriteString("agents:\n  scan_method: tmux\n  auto_restart: false\n  allow_shell: false\n")
	b.WriteString("wireguard:\n  enabled: false\nstun:\n  enabled: false\n")
	return []byte(b.String())
}

// sameOrganization reports whether an existing configuration already belongs
// to the access string's network, chain, packages and organization.
func sameOrganization(cfg *config.Config, access hostJoinAccess) bool {
	original := cfg.SUI.ProtocolOriginalPackageID
	if original == "" {
		original = cfg.SUI.ProtocolPackageID
	}
	return cfg.SUI.Network == access.Network && cfg.SUI.ChainIdentifier == access.ChainIdentifier && cfg.SUI.OrgID == access.OrgID &&
		cfg.SUI.ProtocolPackageID == access.ProtocolPackageID && original == access.ProtocolOriginalPackageID &&
		cfg.SUI.ProtocolRegistryID == access.ProtocolRegistryID && cfg.SUI.HostConnectionEnabled
}

func readHostAccess(input *os.File, lines *bufio.Reader, diagnostic io.Writer) ([]byte, error) {
	if _, err := fmt.Fprint(diagnostic, "Paste the Host access string from the FractalMind App (input hidden): "); err != nil {
		return nil, err
	}
	if term.IsTerminal(int(input.Fd())) {
		raw, err := term.ReadPassword(int(input.Fd()))
		fmt.Fprintln(diagnostic)
		if err != nil {
			return nil, fmt.Errorf("cannot read hidden Host access input")
		}
		return raw, nil
	}
	line, err := lines.ReadSlice('\n')
	if err != nil && err != io.EOF {
		clear(line)
		return nil, fmt.Errorf("Host access input exceeds the line limit")
	}
	owned := append([]byte(nil), line...)
	clear(line)
	return owned, nil
}

// runJoinCommand is the one-step Host admission: paste the App's access string,
// let envd write the public configuration and create this Host's identity if
// needed, compare a short fingerprint, and join. Invitation Gas the App placed
// on the invitation pays for the join, so the new Host needs no funding.
func runJoinCommand(args []string, input *os.File, output, diagnostic io.Writer) error {
	flags := flag.NewFlagSet("join", flag.ContinueOnError)
	flags.SetOutput(diagnostic)
	configPath := flags.String("config", defaultHostConfigPath(), "configuration file to create or reuse")
	name := flags.String("name", "", "Host name shown in the App (default: this computer's name)")
	profile := flags.String("profile", "host", "credential-store profile for this Host's keys")
	keyStore := flags.String("key-store", "native", "where to keep this Host's keys: native (OS credential store) or file (owner-only files; test and development Hosts)")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if flags.NArg() != 0 {
		return fmt.Errorf("the access string is read from stdin, never from arguments")
	}
	if *keyStore != "native" && *keyStore != "file" {
		return fmt.Errorf("--key-store must be native or file")
	}
	if *name == "" {
		*name, _ = os.Hostname()
	}
	// One reader serves both prompts so piped input is not lost between them.
	lines := bufio.NewReaderSize(input, maxHostJoinAccess+2)
	raw, err := readHostAccess(input, lines, diagnostic)
	if err != nil {
		return err
	}
	access, invite, err := parseHostJoinAccess(raw)
	clear(raw)
	if err != nil {
		return err
	}
	defer clear(invite)
	if _, statErr := os.Stat(*configPath); errors.Is(statErr, os.ErrNotExist) {
		if err = os.MkdirAll(filepath.Dir(*configPath), 0o700); err != nil {
			return err
		}
		keyDir, err := filepath.Abs(filepath.Join(filepath.Dir(*configPath), "keys"))
		if err != nil {
			return err
		}
		if err = os.WriteFile(*configPath, hostJoinConfig(access, *profile, *name, *keyStore, keyDir), 0o600); err != nil {
			return err
		}
		fmt.Fprintf(diagnostic, "Wrote configuration %s\n", *configPath)
	} else if statErr != nil {
		return statErr
	}
	cfg, err := config.Load(*configPath)
	if err != nil {
		return err
	}
	if !sameOrganization(cfg, access) {
		return fmt.Errorf("%s belongs to another network or organization; pass --config with a new path", *configPath)
	}
	store, err := hostidentity.OpenConfiguredStore(cfg.Identity.KeyStore, cfg.Identity.SecretServiceCollection, cfg.Identity.KeyDir)
	if err != nil {
		return err
	}
	keys, err := hostidentity.Load(store, cfg.Identity.KeyProfile)
	if errors.Is(err, hostidentity.ErrNotFound) {
		fmt.Fprintln(diagnostic, "Creating this Host's identity in the system credential store")
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		keys, err = hostidentity.Initialize(ctx, store, cfg.Identity.KeyProfile, "")
		cancel()
	}
	if err != nil {
		if runtime.GOOS == "darwin" && cfg.Identity.KeyStore != "file" {
			return fmt.Errorf("%w\nmacOS keeps Host keys in the login Keychain, which an SSH session cannot open. Run this command in Terminal on this Mac while logged in, or use --key-store file on a test Host", err)
		}
		return err
	}
	keys.Close()

	ui := hostjoin.Interaction{
		ReadInvitation: func() ([]byte, error) { return append([]byte(nil), invite...), nil },
		GasClaimed: func(claim sui.InviteGasClaim) error {
			_, err := fmt.Fprintf(diagnostic, "Received %s MIST of joining Gas from the invitation\n", claim.Amount)
			return err
		},
		Confirm: func(plan nodecommand.HostJoinPlan, quote sui.HostJoinQuote, _ hostidentity.Public) (bool, error) {
			fmt.Fprintf(diagnostic, "\nOrganization  %s (%s)\nFingerprint   %s\nCoordinator   %s\nJoin fee      about %s MIST (maximum %d)\nGrants membership and limited observation only, not Agent execution.\n",
				plan.OrganizationName, plan.OrganizationID, hostJoinFingerprint(plan.OrganizationID, plan.BindingID), plan.Endpoint, quote.EstimatedNetFee, quote.GasBudget)
			if _, err := fmt.Fprint(diagnostic, "Does the fingerprint match the one in the App? Type y to join: "); err != nil {
				return false, err
			}
			answer, err := lines.ReadString('\n')
			if err != nil && !errors.Is(err, io.EOF) {
				return false, err
			}
			return strings.EqualFold(strings.TrimSpace(answer), "y"), nil
		},
		Prepared: func(record hostjoin.Record) error {
			_, err := fmt.Fprintf(diagnostic, "Submitting join transaction %s\n", record.Digest)
			return err
		},
	}
	result, err := hostJoinRun(context.Background(), cfg, false, false, "", ui)
	switch {
	case result.State == "cancelled":
		fmt.Fprintln(output, "Cancelled. Nothing was signed for the join.")
		return nil
	case err != nil:
		if result.Digest != "" {
			return fmt.Errorf("%w\nCheck the original transaction: fractalmind-envd --config %s --host-join-status", err, *configPath)
		}
		return err
	case result.State == "failed":
		return fmt.Errorf("the join transaction failed (fee %s MIST); create a new invitation in the App", result.ActualFee)
	}
	fmt.Fprintf(output, "Joined %s.\nStart envd on this Host:\n  %s --config %s\n", access.OrgID, os.Args[0], *configPath)
	if runtime.GOOS == "darwin" {
		fmt.Fprintln(output, "To keep it running after login, install the LaunchAgent (scripts/macos_launchagent.py install).")
	}
	return nil
}
