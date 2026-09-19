//go:build !unix

package runtimeadapter

import "os/exec"

func configureProcessGroup(_ *exec.Cmd) {}

func supportsProcessGroupCancellation() bool { return false }
