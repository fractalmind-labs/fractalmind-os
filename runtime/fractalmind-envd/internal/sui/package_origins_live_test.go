package sui

import (
	"context"
	"os"
	"testing"
	"time"
)

// Explicit read-only preflight of the existing isolated upgrade, before any
// native fixture creates identities or broadcasts a transaction.
func TestMixedPackageOriginsLive(t *testing.T) {
	if os.Getenv("FM_MIXED_ORIGINS_READ_ONLY") != "1" {
		t.Skip("explicit isolated localnet read required")
	}
	id := os.Getenv("FM_MIXED_CORE_PACKAGE")
	original := os.Getenv("FM_MIXED_ORIGINAL_PACKAGE")
	if id == "" || original == "" || id == original {
		t.Fatal("mixed package IDs required")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	client, err := NewGRPCClient("http://127.0.0.1:29000", "")
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	values, err := client.ReadChainTypeOrigins(ctx, id)
	if err != nil {
		t.Fatal(err)
	}
	for _, kind := range []string{"organization::Organization", "organization::ProtocolRegistry", "remote_authority::RemoteCapability"} {
		if values[kind] != original {
			t.Fatalf("old %s origin changed", kind)
		}
	}
	for _, kind := range []string{"remote_authority::BoundBudgetClaim", "host::HostMembership", "identity::HumanIdentity", "node_execution::CommandExecution", "execution_extension::FieldKey"} {
		if values[kind] != id {
			t.Fatalf("new %s origin is not the actual introducing package", kind)
		}
	}
	t.Logf("read-only mixed package origins verified: %d datatypes; zero transactions", len(values))
}
