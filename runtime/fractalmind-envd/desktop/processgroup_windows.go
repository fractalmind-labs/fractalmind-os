//go:build windows

package desktop

import "os"

func EnsureOwnProcessGroup() error { return nil }

func ExitProcessGroup() { os.Exit(0) }
