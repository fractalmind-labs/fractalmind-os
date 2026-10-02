//go:build linux

package agent

import (
	"fmt"
	"os"
	"strconv"
	"strings"
)

const supportsProcessBirth = true

func processBirth(pid int) (string, error) {
	boot, err := os.ReadFile("/proc/sys/kernel/random/boot_id")
	if err != nil || len(boot) == 0 {
		return "", fmt.Errorf("boot identity unavailable")
	}
	stat, err := os.ReadFile(fmt.Sprintf("/proc/%d/stat", pid))
	if err != nil {
		return "", fmt.Errorf("process identity unavailable")
	}
	// comm can contain spaces and ')'. Fields following its last ')' begin at 3.
	i := strings.LastIndexByte(string(stat), ')')
	if i < 0 {
		return "", fmt.Errorf("invalid process stat")
	}
	fields := strings.Fields(string(stat)[i+1:])
	if len(fields) < 20 {
		return "", fmt.Errorf("invalid process stat")
	}
	ticks, err := strconv.ParseUint(fields[19], 10, 64)
	if err != nil || ticks == 0 {
		return "", fmt.Errorf("invalid process birth")
	}
	return strings.TrimSpace(string(boot)) + ":" + strconv.FormatUint(ticks, 10), nil
}
