package channels

import (
	"context"
	"testing"
	"time"
)

func TestManagerRegistersIMessageChannel(t *testing.T) {
	originalGOOS := currentGOOS
	currentGOOS = "darwin"
	defer func() { currentGOOS = originalGOOS }()

	cfg := v2Config(t, "  imessage:\n    main: {recipient: recipient@example.com}\n", map[string]string{"bot": "imessage.main"})
	manager := NewManager(cfg, nil)
	if err := manager.Start(context.Background()); err != nil {
		t.Fatalf("start: %v", err)
	}
	defer func() { _ = manager.Stop() }()

	waitForCondition(t, time.Second, func() bool {
		channel := manager.Get("imessage")
		return channel != nil && channel.IsRunning()
	})
}

func TestManagerReportsIMessageOnNonDarwinAsUnavailable(t *testing.T) {
	originalGOOS := currentGOOS
	currentGOOS = "linux"
	defer func() { currentGOOS = originalGOOS }()

	cfg := v2Config(t, "  imessage:\n    main: {recipient: recipient@example.com}\n", map[string]string{"bot": "imessage.main"})
	manager := NewManager(cfg, nil)
	if err := manager.Start(context.Background()); err != nil {
		t.Fatalf("start: %v", err)
	}
	if reason := manager.Unavailable()["imessage.main"]; reason == "" {
		t.Fatal("expected imessage to be reported unavailable")
	}
}
