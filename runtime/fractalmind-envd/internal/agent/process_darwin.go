//go:build darwin

package agent

import (
	"fmt"
	"golang.org/x/sys/unix"
)

const supportsProcessBirth = true

func processBirth(pid int) (string, error) {
	boot, err := unix.Sysctl("kern.bootsessionuuid")
	if err != nil || boot == "" {
		return "", fmt.Errorf("boot identity unavailable")
	}
	k, err := unix.SysctlKinfoProc("kern.proc.pid", pid)
	if err != nil || int(k.Proc.P_pid) != pid || k.Proc.P_starttime.Sec <= 0 {
		return "", fmt.Errorf("process identity unavailable")
	}
	return fmt.Sprintf("%s:%d:%d", boot, k.Proc.P_starttime.Sec, k.Proc.P_starttime.Usec), nil
}
