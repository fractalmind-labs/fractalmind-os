package main

import (
	"bytes"
	"fmt"
	"os"
	"strings"
	"testing"

	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/config"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/hostidentity"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/nodecommand"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/sui"
	"golang.org/x/term"
)

func TestHostJoinCLISecretInputAndExactConfirmation(t *testing.T) {
	for _, answer := range []string{"JOIN 0xorganization", "yes", "JOIN 0xother"} {
		t.Run(answer, func(t *testing.T) {
			input, writer, err := os.Pipe()
			if err != nil {
				t.Fatal(err)
			}
			defer input.Close()
			secret := "fixture-secret-never-log"
			go func() { defer writer.Close(); writer.Write([]byte(secret + "\n" + answer + "\n")) }()
			var output, diagnostic bytes.Buffer
			ui := hostJoinInteraction(input, &output, &diagnostic)
			credential, err := ui.ReadInvitation()
			if err != nil || string(credential) != secret {
				t.Fatal("bounded stdin credential lost")
			}
			clear(credential)
			ok, err := ui.Confirm(nodecommand.HostJoinPlan{OrganizationID: "0xorganization"}, sui.HostJoinQuote{TxBytes: "raw-transaction-must-not-be-printed", EstimatedNetFee: "123", GasBudget: 200}, hostidentity.Public{})
			if err != nil || ok != (answer == "JOIN 0xorganization") {
				t.Fatal("ambiguous confirmation accepted")
			}
			if strings.Contains(output.String()+diagnostic.String(), secret) || strings.Contains(output.String(), "raw-transaction-must-not-be-printed") {
				t.Fatal("credential or raw transaction leaked to output")
			}
		})
	}
}

func TestHostJoinHiddenTTY(t *testing.T) {
	if os.Getenv("FM_HOST_JOIN_TTY_FIXTURE") != "1" {
		t.Skip("explicit pseudo-terminal fixture only")
	}
	if !term.IsTerminal(int(os.Stdin.Fd())) {
		t.Fatal("fixture did not provide a terminal")
	}
	ui := hostJoinInteraction(os.Stdin, os.Stdout, os.Stderr)
	credential, err := ui.ReadInvitation()
	if err != nil || string(credential) != "fixture-tty-credential" {
		t.Fatal("hidden terminal credential read failed")
	}
	clear(credential)
	confirmed, err := ui.Confirm(nodecommand.HostJoinPlan{OrganizationID: "0xfixture"}, sui.HostJoinQuote{EstimatedNetFee: "10", GasBudget: 100}, hostidentity.Public{})
	if err != nil || !confirmed {
		t.Fatal("terminal confirmation failed")
	}
	fmt.Println("FM_HOST_JOIN_TTY_OK")
}
func TestHostJoinCLIRejectsOversizedSecretWithoutEcho(t *testing.T) {
	input, writer, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	defer input.Close()
	secret := strings.Repeat("secret", 100)
	go func() { defer writer.Close(); writer.Write([]byte(secret + "\n")) }()
	var output, diagnostic bytes.Buffer
	ui := hostJoinInteraction(input, &output, &diagnostic)
	if _, err = ui.ReadInvitation(); err == nil || strings.Contains(err.Error(), secret) {
		t.Fatal("oversized secret accepted or echoed")
	}
}

func TestAppHostJoinConfirmsOnlyTheConfiguredLocalBinding(t *testing.T) {
	public := hostidentity.Public{Address: "0xhost", SigningPublicKey: "aa"}
	base := func() *config.Config {
		cfg := config.DefaultConfig()
		cfg.Roles.Coordinator = true
		cfg.Coordinator.ListenAddr = "127.0.0.1:7443"
		cfg.Coordinator.BindingID = "0xbinding"
		cfg.SUI.OrgID = "0xorganization"
		cfg.SUI.HostJoinGasBudget = 300
		return cfg
	}
	plan := nodecommand.HostJoinPlan{OrganizationID: "0xorganization", BindingID: "0xbinding", CoordinatorPublicKey: "aa", CoordinatorAddress: "0xhost", Endpoint: "http://127.0.0.1:7443"}
	cases := map[string]struct {
		edit func(*config.Config, *nodecommand.HostJoinPlan, *sui.HostJoinQuote)
		ok   bool
	}{
		"matching": {func(*config.Config, *nodecommand.HostJoinPlan, *sui.HostJoinQuote) {}, true},
		"other org": {func(_ *config.Config, p *nodecommand.HostJoinPlan, _ *sui.HostJoinQuote) {
			p.OrganizationID = "0xother"
		}, false},
		"other binding": {func(_ *config.Config, p *nodecommand.HostJoinPlan, _ *sui.HostJoinQuote) { p.BindingID = "0xother" }, false},
		"remote key": {func(_ *config.Config, p *nodecommand.HostJoinPlan, _ *sui.HostJoinQuote) {
			p.CoordinatorPublicKey = "bb"
		}, false},
		"remote endpoint": {func(_ *config.Config, p *nodecommand.HostJoinPlan, _ *sui.HostJoinQuote) {
			p.Endpoint = "https://example.com"
		}, false},
		"other port": {func(_ *config.Config, p *nodecommand.HostJoinPlan, _ *sui.HostJoinQuote) {
			p.Endpoint = "http://127.0.0.1:7444"
		}, false},
		"coordinator off":   {func(c *config.Config, _ *nodecommand.HostJoinPlan, _ *sui.HostJoinQuote) { c.Roles.Coordinator = false }, false},
		"gas above ceiling": {func(_ *config.Config, _ *nodecommand.HostJoinPlan, q *sui.HostJoinQuote) { q.GasBudget = 301 }, false},
	}
	for name, c := range cases {
		t.Run(name, func(t *testing.T) {
			cfg, p, q := base(), plan, sui.HostJoinQuote{GasBudget: 300, TxBytes: "raw-transaction-must-not-be-printed"}
			c.edit(cfg, &p, &q)
			secret := "fixture-secret-never-log"
			var output bytes.Buffer
			ui := appHostJoinInteraction(strings.NewReader(secret+"\n"), &output, cfg)
			code, err := ui.ReadInvitation()
			if err != nil || string(code) != secret {
				t.Fatal("stdin invitation lost")
			}
			ok, err := ui.Confirm(p, q, public)
			if err != nil || ok != c.ok {
				t.Fatalf("confirmed=%v err=%v", ok, err)
			}
			if strings.Contains(output.String(), secret) || strings.Contains(output.String(), "raw-transaction") {
				t.Fatal("invitation or raw transaction leaked")
			}
		})
	}
	for _, listen := range []string{":7443", "0.0.0.0:7443", "127.0.0.1:0", "localhost:7443"} {
		if _, err := localHostEndpoint(listen); err == nil {
			t.Fatalf("%s accepted as a fixed loopback listener", listen)
		}
	}
}
