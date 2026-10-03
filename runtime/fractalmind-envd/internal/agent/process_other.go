//go:build !darwin && !linux

package agent

import "fmt"

const supportsProcessBirth = false

func processBirth(int) (string, error) { return "", fmt.Errorf("process continuity unsupported") }
