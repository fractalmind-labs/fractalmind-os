package ssh

import (
	"fmt"
	"strings"
)

type Options struct {
	Host                       string
	Dir                        string
	PermissionMode             string
	DangerouslySkipPermissions bool
	Local                      bool
}

type Result struct {
	Status                     string
	Action                     string
	Host                       string
	Dir                        string
	PermissionMode             string
	DangerouslySkipPermissions bool
	Local                      bool
}

func Run(args []string) (Result, error) {
	opts, err := parseArgs(args)
	if err != nil {
		return Result{}, err
	}

	return Result{
		Status:                     "stub",
		Action:                     "connect-ssh",
		Host:                       opts.Host,
		Dir:                        opts.Dir,
		PermissionMode:             opts.PermissionMode,
		DangerouslySkipPermissions: opts.DangerouslySkipPermissions,
		Local:                      opts.Local,
	}, nil
}

func parseArgs(args []string) (Options, error) {
	var opts Options
	var positionals []string

	for i := 0; i < len(args); i++ {
		switch {
		case args[i] == "--permission-mode":
			if i+1 >= len(args) {
				return Options{}, fmt.Errorf("--permission-mode requires a value")
			}
			opts.PermissionMode = strings.TrimSpace(args[i+1])
			if opts.PermissionMode == "" {
				return Options{}, fmt.Errorf("--permission-mode requires a value")
			}
			i++
		case strings.HasPrefix(args[i], "--permission-mode="):
			opts.PermissionMode = strings.TrimSpace(strings.TrimPrefix(args[i], "--permission-mode="))
			if opts.PermissionMode == "" {
				return Options{}, fmt.Errorf("--permission-mode requires a value")
			}
		case args[i] == "--dangerously-skip-permissions":
			opts.DangerouslySkipPermissions = true
		case args[i] == "--local":
			opts.Local = true
		case strings.HasPrefix(args[i], "--"):
			return Options{}, fmt.Errorf("unknown option: %s", args[i])
		default:
			positionals = append(positionals, args[i])
		}
	}

	if len(positionals) == 0 || strings.TrimSpace(positionals[0]) == "" {
		return Options{}, fmt.Errorf("usage: claude-code-go ssh <host> [dir] [--permission-mode <mode>] [--dangerously-skip-permissions] [--local]")
	}
	if len(positionals) > 2 {
		return Options{}, fmt.Errorf("usage: claude-code-go ssh <host> [dir] [--permission-mode <mode>] [--dangerously-skip-permissions] [--local]")
	}

	opts.Host = strings.TrimSpace(positionals[0])
	if len(positionals) == 2 {
		opts.Dir = strings.TrimSpace(positionals[1])
	}
	return opts, nil
}

func (r Result) String() string {
	var b strings.Builder
	b.WriteString(fmt.Sprintf("status=%s\n", r.Status))
	b.WriteString(fmt.Sprintf("action=%s\n", r.Action))
	b.WriteString(fmt.Sprintf("host=%s\n", valueOrNone(r.Host)))
	b.WriteString(fmt.Sprintf("dir=%s\n", valueOrNone(r.Dir)))
	b.WriteString(fmt.Sprintf("permission_mode=%s\n", valueOrNone(r.PermissionMode)))
	b.WriteString(fmt.Sprintf("dangerously_skip_permissions=%t\n", r.DangerouslySkipPermissions))
	b.WriteString(fmt.Sprintf("local_mode=%t\n", r.Local))
	return b.String()
}

func valueOrNone(v string) string {
	if strings.TrimSpace(v) == "" {
		return "none"
	}
	return v
}
