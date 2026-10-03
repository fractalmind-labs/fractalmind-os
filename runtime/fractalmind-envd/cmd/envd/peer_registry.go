package main

import (
	"fmt"
	"strings"

	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/config"
)

// Host admission and signed execution use sui.enabled too. The older mesh
// registry has separate package/registry IDs and must be explicitly configured
// before startup may register a peer or create an AgentCertificate.
func peerRegistryEnabled(cfg *config.Config) (bool, error) {
	if cfg == nil {
		return false, fmt.Errorf("config is required")
	}
	if !cfg.SUI.Enabled {
		return false, nil
	}
	packageSet := strings.TrimSpace(cfg.SUI.PackageID) != ""
	registrySet := strings.TrimSpace(cfg.SUI.RegistryID) != ""
	if packageSet != registrySet {
		return false, fmt.Errorf("peer registration requires both sui.package_id and sui.registry_id")
	}
	return packageSet && registrySet, nil
}
