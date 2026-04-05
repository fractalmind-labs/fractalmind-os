package main

import (
	"context"
	"fmt"
	"os"
	"strings"

	"github.com/fractalmind-ai/claude-code-go/internal/auth"
	"github.com/fractalmind-ai/claude-code-go/internal/client"
	"github.com/fractalmind-ai/claude-code-go/internal/config"
)

func main() {
	code := run(context.Background(), os.Args[1:])
	os.Exit(code)
}

func run(ctx context.Context, args []string) int {
	cfg, err := config.Load()
	if err != nil {
		fmt.Fprintf(os.Stderr, "load config: %v\n", err)
		return 1
	}

	if len(args) == 0 {
		printHelp()
		return 0
	}

	switch args[0] {
	case "auth":
		return runAuth(ctx, cfg, args[1:])
	case "config":
		return runConfig(cfg, args[1:])
	case "api":
		return runAPI(ctx, cfg, args[1:])
	default:
		fmt.Fprintf(os.Stderr, "unknown command: %s\n\n", args[0])
		printHelp()
		return 1
	}
}

func runAuth(ctx context.Context, cfg config.Config, args []string) int {
	if len(args) == 0 {
		fmt.Fprintln(os.Stderr, "usage: claude-code-go auth <status|logout>")
		return 1
	}

	switch args[0] {
	case "status":
		provider := client.New(cfg)
		status := auth.Status(cfg, provider)
		fmt.Println(status.String())
		return 0
	case "logout":
		if err := auth.Logout(ctx, cfg); err != nil {
			fmt.Fprintf(os.Stderr, "logout failed: %v\n", err)
			return 1
		}
		fmt.Println("logged out")
		return 0
	default:
		fmt.Fprintf(os.Stderr, "unknown auth subcommand: %s\n", args[0])
		return 1
	}
}

func runConfig(cfg config.Config, args []string) int {
	if len(args) == 0 || args[0] != "show" {
		fmt.Fprintln(os.Stderr, "usage: claude-code-go config show")
		return 1
	}
	fmt.Printf("config_dir=%s\n", cfg.Dir)
	fmt.Printf("auth_file=%s\n", cfg.AuthFile)
	fmt.Printf("api_base=%s\n", strings.TrimSpace(cfg.APIBase))
	fmt.Printf("api_key_present=%t\n", cfg.APIKey != "")
	fmt.Printf("api_key_source=%s\n", valueOrNone(cfg.APIKeySource))
	return 0
}

func runAPI(ctx context.Context, cfg config.Config, args []string) int {
	if len(args) == 0 {
		fmt.Fprintln(os.Stderr, "usage: claude-code-go api <payload|ping>")
		return 1
	}

	c := client.New(cfg)
	switch args[0] {
	case "payload":
		payload, err := c.BuildMessagesDemoRequest()
		if err != nil {
			fmt.Fprintf(os.Stderr, "build payload failed: %v\n", err)
			return 1
		}
		fmt.Print(payload.DebugString())
		return 0
	case "ping":
		resp, err := c.SendMessagesDemo(ctx)
		if err != nil {
			fmt.Fprintf(os.Stderr, "ping failed: %v\n", err)
			return 1
		}
		fmt.Print(resp.DebugString())
		if resp.StatusCode >= 400 {
			return 1
		}
		return 0
	default:
		fmt.Fprintf(os.Stderr, "unknown api subcommand: %s\n", args[0])
		return 1
	}
}

func printHelp() {
	fmt.Println(`claude-code-go

Usage:
  claude-code-go auth status
  claude-code-go auth logout
  claude-code-go config show
  claude-code-go api payload
  claude-code-go api ping`)
}

func valueOrNone(v string) string {
	if v == "" {
		return "none"
	}
	return v
}
