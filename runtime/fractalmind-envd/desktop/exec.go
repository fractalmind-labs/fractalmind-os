package desktop

import "os/exec"

// runArgv executes argv[0] with argv[1:] and discards output.
func runArgv(argv []string) error {
	if len(argv) == 0 {
		return nil
	}
	return exec.Command(argv[0], argv[1:]...).Run()
}
