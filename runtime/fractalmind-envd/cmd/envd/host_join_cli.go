package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"os"

	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/config"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/hostidentity"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/hostjoin"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/nodecommand"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/sui"
	"golang.org/x/term"
)

func boundedLine(input io.Reader) func() ([]byte, error) {
	reader := bufio.NewReaderSize(input, 512)
	return func() ([]byte, error) {
		frame, err := reader.ReadSlice('\n')
		if err != nil && err != io.EOF {
			clear(frame)
			return nil, fmt.Errorf("Host join input exceeds the line limit")
		}
		owned := append([]byte(nil), bytes.TrimSpace(frame)...)
		clear(frame)
		if len(owned) == 0 {
			clear(owned)
			return nil, fmt.Errorf("Host join input is empty")
		}
		return owned, nil
	}
}
func hostJoinInteraction(input *os.File, output, diagnostic io.Writer) hostjoin.Interaction {
	line := boundedLine(input)
	return hostjoin.Interaction{
		ReadInvitation: func() ([]byte, error) {
			if _, err := fmt.Fprint(diagnostic, "Enter one-use Host invitation (hidden): "); err != nil {
				return nil, err
			}
			if term.IsTerminal(int(input.Fd())) {
				code, err := term.ReadPassword(int(input.Fd()))
				fmt.Fprintln(diagnostic)
				if err != nil {
					return nil, fmt.Errorf("cannot read hidden invitation input")
				}
				if len(code) > 512 {
					clear(code)
					return nil, fmt.Errorf("invitation exceeds input limit")
				}
				return code, nil
			}
			return line()
		},
		Confirm: func(plan nodecommand.HostJoinPlan, quote sui.HostJoinQuote, public hostidentity.Public) (bool, error) {
			preview := struct {
				Phase string                   `json:"phase"`
				Plan  nodecommand.HostJoinPlan `json:"plan"`
				Quote sui.HostJoinQuote        `json:"quote"`
				Host  hostidentity.Public      `json:"host"`
			}{"preview", plan, quote, public}
			if err := json.NewEncoder(output).Encode(preview); err != nil {
				return false, err
			}
			if _, err := fmt.Fprintf(diagnostic, "Verify network, organization, Coordinator key and finite observation permissions. This does not grant Agent execution authority.\nHost pays Gas (MIST); estimated %s, maximum %d.\nTo confirm type JOIN %s; anything else cancels: ", quote.EstimatedNetFee, quote.GasBudget, plan.OrganizationID); err != nil {
				return false, err
			}
			answer, err := line()
			if err != nil {
				return false, err
			}
			defer clear(answer)
			return bytes.Equal(answer, []byte("JOIN "+plan.OrganizationID)), nil
		},
		Prepared: preparedOutput(output),
	}
}
func preparedOutput(output io.Writer) func(hostjoin.Record) error {
	return func(record hostjoin.Record) error {
		return json.NewEncoder(output).Encode(struct {
			Phase  string          `json:"phase"`
			Record hostjoin.Record `json:"transaction"`
		}{"prepared", record})
	}
}

// localHostEndpoint is the only Coordinator origin a desktop-local setup binds.
func localHostEndpoint(listen string) (string, error) {
	host, port, err := net.SplitHostPort(listen)
	if err != nil || host != "127.0.0.1" || port == "" || port == "0" {
		return "", fmt.Errorf("local Host setup requires a fixed 127.0.0.1 Coordinator port")
	}
	return "http://" + net.JoinHostPort(host, port), nil
}

// appHostJoinInteraction serves the desktop App's one-confirmation setup. The
// person confirmed the organization, this Host key as the Coordinator key and
// the loopback endpoint in the App, which created exactly that binding and a
// one-use invitation. Here the invitation arrives on stdin (never argv or
// output) and the join proceeds only when the chain plan matches that
// configuration; anything else cancels without signing.
func appHostJoinInteraction(input io.Reader, output io.Writer, cfg *config.Config) hostjoin.Interaction {
	line := boundedLine(input)
	return hostjoin.Interaction{
		ReadInvitation: line,
		Confirm: func(plan nodecommand.HostJoinPlan, quote sui.HostJoinQuote, public hostidentity.Public) (bool, error) {
			endpoint, err := localHostEndpoint(cfg.Coordinator.ListenAddr)
			if err != nil {
				return false, err
			}
			matches := cfg.Roles.Coordinator && plan.OrganizationID == cfg.SUI.OrgID && plan.BindingID == cfg.Coordinator.BindingID &&
				plan.CoordinatorPublicKey == public.SigningPublicKey && plan.CoordinatorAddress == public.Address &&
				plan.Endpoint == endpoint && quote.GasBudget <= cfg.SUI.HostJoinGasBudget
			preview := struct {
				Phase     string                   `json:"phase"`
				Plan      nodecommand.HostJoinPlan `json:"plan"`
				Quote     sui.HostJoinQuote        `json:"quote"`
				Host      hostidentity.Public      `json:"host"`
				Confirmed bool                     `json:"confirmed"`
			}{"preview", plan, quote, public, matches}
			if err := json.NewEncoder(output).Encode(preview); err != nil {
				return false, err
			}
			return matches, nil
		},
		Prepared: preparedOutput(output),
	}
}
func runHostJoinCLI(ctx context.Context, cfg *config.Config, statusOnly, newAttempt bool, address string, ui hostjoin.Interaction, output io.Writer) error {
	client, err := sui.NewGRPCClient(cfg.SUI.RPC, cfg.SUI.GraphQLURL)
	if err != nil {
		return err
	}
	defer client.Close()
	var keys *hostidentity.Keys
	if !statusOnly {
		store, err := hostidentity.OpenNativeStoreWithCollection(cfg.Identity.SecretServiceCollection)
		if err != nil {
			return err
		}
		keys, err = hostidentity.Load(store, cfg.Identity.KeyProfile)
		if err != nil {
			return err
		}
		defer keys.Close()
	}
	if address == "" {
		address = cfg.Identity.HostID
	}
	typesPackage := cfg.SUI.ProtocolOriginalPackageID
	if typesPackage == "" {
		typesPackage = cfg.SUI.ProtocolPackageID
	}
	factory := func(original string) (hostjoin.Authority, error) {
		return nodecommand.NewChainAuthorityResolverForPackage(client, cfg.SUI.ProtocolPackageID, original)
	}
	result, err := hostjoin.Run(ctx, client, factory, keys, hostjoin.Options{Network: cfg.SUI.Network, Chain: cfg.SUI.ChainIdentifier, PackageID: cfg.SUI.ProtocolPackageID, TypesPackageID: typesPackage, RegistryID: cfg.SUI.ProtocolRegistryID, ExpectedOrganization: cfg.SUI.OrgID, Profile: cfg.Identity.KeyProfile, Name: cfg.Identity.Hostname, PublicAddress: address, GasBudget: cfg.SUI.HostJoinGasBudget, StatusOnly: statusOnly, NewAttempt: newAttempt}, ui)
	if result.State != "" {
		if writeErr := json.NewEncoder(output).Encode(result); writeErr != nil {
			return writeErr
		}
	}
	if err != nil {
		return err
	}
	if result.State == "failed" {
		return fmt.Errorf("original Host admission failed; fee preserved, no automatic retry")
	}
	return nil
}
