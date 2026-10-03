package main

import (
	"bytes"
	"fmt"
	"os"
	"strings"
	"testing"

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
