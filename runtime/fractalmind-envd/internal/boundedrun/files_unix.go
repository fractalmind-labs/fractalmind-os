//go:build linux || darwin

package boundedrun

import (
	"os"
	"syscall"
)

func readFlags() int { return os.O_RDONLY | syscall.O_NONBLOCK | syscall.O_NOFOLLOW }
func safeRegularFile(_ *os.File, info os.FileInfo) bool {
	if !info.Mode().IsRegular() {
		return false
	}
	stat, ok := info.Sys().(*syscall.Stat_t)
	return ok && stat.Nlink == 1
}
