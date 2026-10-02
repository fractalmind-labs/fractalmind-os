package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"

	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/config"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/hostidentity"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/hostjoin"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/nodecommand"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/sui"
	"golang.org/x/term"
)

func hostJoinInteraction(input *os.File, output, diagnostic io.Writer) hostjoin.Interaction {
	reader := bufio.NewReaderSize(input, 512)
	line := func() ([]byte, error) {
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
		Prepared: func(record hostjoin.Record) error {
			return json.NewEncoder(output).Encode(struct {
				Phase  string          `json:"phase"`
				Record hostjoin.Record `json:"transaction"`
			}{"prepared", record})
		},
	}
}
func runHostJoinCLI(ctx context.Context, cfg *config.Config, statusOnly, newAttempt bool, address string, input *os.File, output, diagnostic io.Writer) error {
	client, err := sui.NewGRPCClient(cfg.SUI.RPC, cfg.SUI.GraphQLURL)
	if err != nil {
		return err
	}
	defer client.Close()
	var keys *hostidentity.Keys
	if !statusOnly {
		store, err := hostidentity.OpenNativeStore()
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
		return nodecommand.NewChainAuthorityResolver(client, original)
	}
	result, err := hostjoin.Run(ctx, client, factory, keys, hostjoin.Options{Network: cfg.SUI.Network, Chain: cfg.SUI.ChainIdentifier, PackageID: cfg.SUI.ProtocolPackageID, TypesPackageID: typesPackage, RegistryID: cfg.SUI.ProtocolRegistryID, ExpectedOrganization: cfg.SUI.OrgID, Profile: cfg.Identity.KeyProfile, Name: cfg.Identity.Hostname, PublicAddress: address, GasBudget: cfg.SUI.HostJoinGasBudget, StatusOnly: statusOnly, NewAttempt: newAttempt}, hostJoinInteraction(input, output, diagnostic))
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
