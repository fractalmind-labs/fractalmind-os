//go:build windows

package agent

import (
	"errors"
	"os"
)

func validateClaudeDesktopMessagingSocketPlatform(os.FileInfo) error {
	return errors.New("Claude Desktop relay is supported only on macOS and Linux")
}

func processIsAlive(int) bool {
	return false
}
