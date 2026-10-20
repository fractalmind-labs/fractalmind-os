package channels

import "testing"

func TestManagerRegistersDemailChannel(t *testing.T) {
	cfg := v2Config(t, "  demail:\n    main: {graphqlUrl: \"https://graphql.testnet.sui.io/graphql\", packageId: \""+demailTestPackageID+"\", address: \""+demailTestAddress+"\", identityKey: secret:demail-main}\n", map[string]string{"bot": "demail.main"})
	manager := NewManager(cfg, map[string]string{"demail-main": "key-material"})
	if err := manager.registerConfiguredChannels(); err != nil {
		t.Fatalf("registerConfiguredChannels: %v", err)
	}
	channel, ok := manager.Get("demail").(*DemailChannel)
	if !ok || channel.graphqlURL != "https://graphql.testnet.sui.io/graphql" || channel.identityKey != "key-material" {
		t.Fatalf("demail channel: %#v", manager.Get("demail"))
	}
}
