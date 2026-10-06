//go:build !linux && !darwin && !windows

package boundedrun

import "os"

// The bounded runtime needs a verified native file-handle provider on these
// platforms. A successful generic file open cannot prove hardlink isolation.
func readFlags() int                             { return os.O_RDONLY }
func safeRegularFile(*os.File, os.FileInfo) bool { return false }
