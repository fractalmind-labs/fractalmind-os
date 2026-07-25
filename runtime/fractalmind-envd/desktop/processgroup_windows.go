//go:build windows

package desktop

import "os"

func ExitProcessGroup() { os.Exit(0) }
