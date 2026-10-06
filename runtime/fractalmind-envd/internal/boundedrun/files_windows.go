//go:build windows

package boundedrun

import (
	"golang.org/x/sys/windows"
	"os"
)

func readFlags() int { return os.O_RDONLY }
func safeRegularFile(file *os.File, info os.FileInfo) bool {
	if !info.Mode().IsRegular() {
		return false
	}
	var metadata windows.ByHandleFileInformation
	return windows.GetFileInformationByHandle(windows.Handle(file.Fd()), &metadata) == nil && metadata.NumberOfLinks == 1
}
