//go:build windows

package desktop

// Windows supervision relies on the parent terminating the child. The macOS
// and Linux worker path additionally detects a hard parent crash.
func parentAlive(int) bool { return true }
