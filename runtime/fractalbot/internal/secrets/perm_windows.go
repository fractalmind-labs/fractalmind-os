//go:build windows

package secrets

// checkOwnerOnly is a no-op on Windows: files under the per-user
// %LOCALAPPDATA% inherit an ACL limited to the user, SYSTEM and
// administrators. Checking explicit ACLs is left to a later change.
func checkOwnerOnly(string, bool) error { return nil }
