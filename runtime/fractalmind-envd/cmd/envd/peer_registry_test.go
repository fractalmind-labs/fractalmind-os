package main

import (
	"testing"

	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/config"
)

func TestAdmissionAndExecutionDoNotEnableMeshRegistration(t *testing.T) {
	for _, execution := range []bool{false, true} {
		cfg := &config.Config{SUI: config.SUIConfig{Enabled: true, HostConnectionEnabled: true, ProtocolPackageID: "protocol", ProtocolRegistryID: "organization-registry"}, Runtime: config.RuntimeConfig{Enabled: execution}}
		if enabled, err := peerRegistryEnabled(cfg); enabled || err != nil {
			t.Fatal("new Host configuration enabled mesh peer/AgentCertificate writes")
		}
		cfg.SUI.PackageID = "mesh"
		if enabled, err := peerRegistryEnabled(cfg); enabled || err == nil {
			t.Fatal("partial mesh configuration permitted automatic registration")
		}
		cfg.SUI.RegistryID = "peer-registry"
		if enabled, err := peerRegistryEnabled(cfg); !enabled || err != nil {
			t.Fatal("explicit mesh registry configuration was lost")
		}
	}
}
