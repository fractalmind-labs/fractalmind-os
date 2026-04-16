package main

import (
	"context"
	"fmt"
	"os"
	"strings"

	"github.com/fractalmind-ai/claude-code-go/internal/agents"
	"github.com/fractalmind-ai/claude-code-go/internal/assistant"
	"github.com/fractalmind-ai/claude-code-go/internal/auth"
	"github.com/fractalmind-ai/claude-code-go/internal/automode"
	"github.com/fractalmind-ai/claude-code-go/internal/client"
	"github.com/fractalmind-ai/claude-code-go/internal/config"
	"github.com/fractalmind-ai/claude-code-go/internal/install"
	"github.com/fractalmind-ai/claude-code-go/internal/mcp"
	"github.com/fractalmind-ai/claude-code-go/internal/open"
	"github.com/fractalmind-ai/claude-code-go/internal/plugin"
	"github.com/fractalmind-ai/claude-code-go/internal/server"
	"github.com/fractalmind-ai/claude-code-go/internal/setuptoken"
	"github.com/fractalmind-ai/claude-code-go/internal/ssh"
	"github.com/fractalmind-ai/claude-code-go/internal/update"
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
	case "doctor":
		return runDoctor(ctx, cfg, args[1:])
	case "auto-mode":
		return runAutoMode(args[1:])
	case "assistant":
		return runAssistant(args[1:])
	case "server":
		return runServer(args[1:])
	case "open":
		return runOpen(args[1:])
	case "ssh":
		return runSSH(args[1:])
	case "setup-token":
		return runSetupToken(args[1:])
	case "mcp":
		return runMCP(args[1:])
	case "plugin":
		return runPlugin(args[1:])
	case "agents":
		return runAgents(args[1:])
	case "install":
		return runInstall(cfg, args[1:])
	case "update":
		return runUpdate(cfg, args[1:])
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
		fmt.Fprintln(os.Stderr, "usage: claude-code-go auth <login|status|logout>")
		return 1
	}

	switch args[0] {
	case "login":
		apiKey := resolveLoginAPIKey(args[1:])
		if err := auth.Login(ctx, cfg, apiKey); err != nil {
			fmt.Fprintf(os.Stderr, "login failed: %v\n", err)
			return 1
		}
		fmt.Printf("logged in\nauth_file=%s\n", cfg.AuthFile)
		return 0
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

func resolveLoginAPIKey(args []string) string {
	for i := 0; i < len(args); i++ {
		if args[i] == "--api-key" && i+1 < len(args) {
			return args[i+1]
		}
	}
	if len(args) > 0 {
		return args[0]
	}
	return firstNonEmpty(
		os.Getenv("CLAUDE_CODE_API_KEY"),
		os.Getenv("ANTHROPIC_API_KEY"),
		os.Getenv("ANTHROPIC_AUTH_TOKEN"),
	)
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
	fmt.Printf("model=%s\n", cfg.Model)
	fmt.Printf("max_tokens=%d\n", cfg.MaxTokens)
	return 0
}

func runDoctor(ctx context.Context, cfg config.Config, args []string) int {
	if len(args) > 0 {
		fmt.Fprintln(os.Stderr, "usage: claude-code-go doctor")
		return 1
	}

	provider := client.New(cfg)
	reachability := provider.CheckReachability(ctx)

	fmt.Printf("config_dir=%s\n", cfg.Dir)
	fmt.Printf("config_dir_exists=%t\n", pathExists(cfg.Dir))
	fmt.Printf("auth_file=%s\n", cfg.AuthFile)
	fmt.Printf("auth_file_exists=%t\n", pathExists(cfg.AuthFile))
	fmt.Printf("api_key_present=%t\n", cfg.APIKey != "")
	fmt.Printf("api_key_source=%s\n", valueOrNone(cfg.APIKeySource))
	fmt.Printf("api_base=%s\n", cfg.APIBase)
	fmt.Printf("model=%s\n", cfg.Model)
	fmt.Printf("max_tokens=%d\n", cfg.MaxTokens)
	fmt.Printf("reachability_target=%s\n", reachability.TargetURL)
	fmt.Printf("reachability_method=%s\n", reachability.Method)
	fmt.Printf("reachability_ok=%t\n", reachability.Reachable)
	if reachability.StatusCode > 0 {
		fmt.Printf("reachability_status_code=%d\n", reachability.StatusCode)
	}
	if reachability.Status != "" {
		fmt.Printf("reachability_status=%s\n", reachability.Status)
	}
	fmt.Printf("reachability_error=%s\n", valueOrNone(reachability.Error))

	if !reachability.Reachable {
		return 1
	}
	return 0
}

func runAutoMode(args []string) int {
	if len(args) == 0 {
		fmt.Fprintln(os.Stderr, "usage: claude-code-go auto-mode <defaults|config>")
		return 1
	}

	var (
		raw string
		err error
	)
	switch args[0] {
	case "defaults":
		if len(args) != 1 {
			fmt.Fprintln(os.Stderr, "usage: claude-code-go auto-mode defaults")
			return 1
		}
		raw, err = automode.JSON(automode.Defaults())
	case "config":
		if len(args) != 1 {
			fmt.Fprintln(os.Stderr, "usage: claude-code-go auto-mode config")
			return 1
		}
		rules, rulesErr := automode.EffectiveConfig()
		if rulesErr != nil {
			fmt.Fprintf(os.Stderr, "auto-mode config failed: %v\n", rulesErr)
			return 1
		}
		raw, err = automode.JSON(rules)
	default:
		fmt.Fprintf(os.Stderr, "unknown auto-mode subcommand: %s\n", args[0])
		return 1
	}
	if err != nil {
		fmt.Fprintf(os.Stderr, "auto-mode output failed: %v\n", err)
		return 1
	}
	fmt.Print(raw)
	return 0
}

func runAssistant(args []string) int {
	result, err := assistant.Run(args)
	if err != nil {
		fmt.Fprintf(os.Stderr, "assistant failed: %v\n", err)
		return 1
	}
	fmt.Print(result.String())
	return 0
}

func runServer(args []string) int {
	err := server.Serve(args, os.Stdout)
	if err != nil {
		fmt.Fprintf(os.Stderr, "server failed: %v\n", err)
		return 1
	}
	return 0
}

func runSSH(args []string) int {
	result, err := ssh.Run(args)
	if err != nil {
		fmt.Fprintf(os.Stderr, "ssh failed: %v\n", err)
		return 1
	}
	fmt.Print(result.String())
	return 0
}

func runOpen(args []string) int {
	result, err := open.Run(args)
	if err != nil {
		fmt.Fprintf(os.Stderr, "open failed: %v\n", err)
		return 1
	}
	fmt.Print(result.String())
	return 0
}

func runPlugin(args []string) int {
	if len(args) == 0 {
		fmt.Fprintln(os.Stderr, "usage: claude-code-go plugin <list|install|uninstall|marketplace>")
		return 1
	}

	switch args[0] {
	case "list":
		if len(args) != 1 {
			fmt.Fprintln(os.Stderr, "usage: claude-code-go plugin list")
			return 1
		}
		result, err := plugin.List()
		if err != nil {
			fmt.Fprintf(os.Stderr, "plugin list failed: %v\n", err)
			return 1
		}
		fmt.Print(result.String())
		return 0
	case "install":
		opts, err := parsePluginInstallArgs(args[1:])
		if err != nil {
			fmt.Fprintf(os.Stderr, "invalid plugin install options: %v\n", err)
			return 1
		}
		result, err := plugin.Install(opts)
		if err != nil {
			fmt.Fprintf(os.Stderr, "plugin install failed: %v\n", err)
			return 1
		}
		fmt.Print(result.String())
		return 0
	case "uninstall":
		opts, err := parsePluginUninstallArgs(args[1:])
		if err != nil {
			fmt.Fprintf(os.Stderr, "invalid plugin uninstall options: %v\n", err)
			return 1
		}
		result, err := plugin.Uninstall(opts)
		if err != nil {
			fmt.Fprintf(os.Stderr, "plugin uninstall failed: %v\n", err)
			return 1
		}
		fmt.Print(result.String())
		return 0
	case "marketplace":
		if len(args) < 2 {
			fmt.Fprintln(os.Stderr, "usage: claude-code-go plugin marketplace <add|list>")
			return 1
		}
		switch args[1] {
		case "add":
			opts, err := parsePluginMarketplaceAddArgs(args[2:])
			if err != nil {
				fmt.Fprintf(os.Stderr, "invalid plugin marketplace add options: %v\n", err)
				return 1
			}
			result, err := plugin.AddMarketplace(opts)
			if err != nil {
				fmt.Fprintf(os.Stderr, "plugin marketplace add failed: %v\n", err)
				return 1
			}
			fmt.Print(result.String())
			return 0
		case "list":
			if len(args) != 2 {
				fmt.Fprintln(os.Stderr, "usage: claude-code-go plugin marketplace list")
				return 1
			}
			result, err := plugin.ListMarketplaces()
			if err != nil {
				fmt.Fprintf(os.Stderr, "plugin marketplace list failed: %v\n", err)
				return 1
			}
			fmt.Print(result.String())
			return 0
		case "remove":
			if len(args) != 3 {
				fmt.Fprintln(os.Stderr, "usage: claude-code-go plugin marketplace remove <name>")
				return 1
			}
			result, err := plugin.RemoveMarketplace(args[2])
			if err != nil {
				fmt.Fprintf(os.Stderr, "plugin marketplace remove failed: %v\n", err)
				return 1
			}
			fmt.Print(result.String())
			return 0
		default:
			fmt.Fprintf(os.Stderr, "unknown plugin marketplace subcommand: %s\n", args[1])
			return 1
		}
	default:
		fmt.Fprintf(os.Stderr, "unknown plugin subcommand: %s\n", args[0])
		return 1
	}
}

func runMCP(args []string) int {
	if len(args) == 0 {
		fmt.Fprintln(os.Stderr, "usage: claude-code-go mcp <list|get|add|remove>")
		return 1
	}

	switch args[0] {
	case "list":
		if len(args) != 1 {
			fmt.Fprintln(os.Stderr, "usage: claude-code-go mcp list")
			return 1
		}
		result, err := mcp.List()
		if err != nil {
			fmt.Fprintf(os.Stderr, "mcp list failed: %v\n", err)
			return 1
		}
		fmt.Print(result.String())
		return 0
	case "get":
		if len(args) != 2 {
			fmt.Fprintln(os.Stderr, "usage: claude-code-go mcp get <name>")
			return 1
		}
		server, err := mcp.Get(args[1])
		if err != nil {
			fmt.Fprintf(os.Stderr, "mcp get failed: %v\n", err)
			return 1
		}
		fmt.Print(server.String())
		return 0
	case "add":
		opts, err := parseMCPAddArgs(args[1:])
		if err != nil {
			fmt.Fprintf(os.Stderr, "invalid mcp add options: %v\n", err)
			return 1
		}
		result, err := mcp.Add(opts)
		if err != nil {
			fmt.Fprintf(os.Stderr, "mcp add failed: %v\n", err)
			return 1
		}
		fmt.Print(result.String())
		return 0
	case "remove":
		opts, err := parseMCPRemoveArgs(args[1:])
		if err != nil {
			fmt.Fprintf(os.Stderr, "invalid mcp remove options: %v\n", err)
			return 1
		}
		result, err := mcp.Remove(opts)
		if err != nil {
			fmt.Fprintf(os.Stderr, "mcp remove failed: %v\n", err)
			return 1
		}
		fmt.Print(result.String())
		return 0
	default:
		fmt.Fprintf(os.Stderr, "unknown mcp subcommand: %s\n", args[0])
		return 1
	}
}

func runSetupToken(args []string) int {
	opts, err := parseSetupTokenArgs(args)
	if err != nil {
		fmt.Fprintf(os.Stderr, "invalid setup-token options: %v\n", err)
		return 1
	}

	result, err := setuptoken.BuildResult(opts)
	if err != nil {
		fmt.Fprintf(os.Stderr, "setup-token failed: %v\n", err)
		return 1
	}

	fmt.Print(result.String())
	return 0
}

func runInstall(_ config.Config, args []string) int {
	target, dryRun, apply, err := parseInstallArgs(args)
	if err != nil {
		fmt.Fprintf(os.Stderr, "invalid install options: %v\n", err)
		return 1
	}

	var plan install.Plan
	if apply {
		plan, err = install.Apply(target)
	} else {
		plan, err = install.BuildPlan(target, dryRun)
	}
	if err != nil {
		fmt.Fprintf(os.Stderr, "install planning failed: %v\n", err)
		return 1
	}

	fmt.Print(plan.String())
	return 0
}

func runAgents(args []string) int {
	settingSources, err := parseAgentsArgs(args)
	if err != nil {
		fmt.Fprintf(os.Stderr, "invalid agents options: %v\n", err)
		return 1
	}

	result, err := agents.List(settingSources)
	if err != nil {
		fmt.Fprintf(os.Stderr, "agents listing failed: %v\n", err)
		return 1
	}

	fmt.Print(result.String())
	return 0
}

func runUpdate(_ config.Config, args []string) int {
	opts, err := parseUpdateArgs(args)
	if err != nil {
		fmt.Fprintf(os.Stderr, "invalid update options: %v\n", err)
		return 1
	}

	result, err := update.BuildResult(opts)
	if err != nil {
		fmt.Fprintf(os.Stderr, "update check failed: %v\n", err)
		return 1
	}

	fmt.Print(result.String())
	return 0
}

func runAPI(ctx context.Context, cfg config.Config, args []string) int {
	if len(args) == 0 {
		fmt.Fprintln(os.Stderr, "usage: claude-code-go api <payload|ping> [--api-base <url>] [--model <name>] [--max-tokens <n>]")
		return 1
	}
	cfg, err := applyAPIOverrides(cfg, args[1:])
	if err != nil {
		fmt.Fprintf(os.Stderr, "invalid api options: %v\n", err)
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

func applyAPIOverrides(cfg config.Config, args []string) (config.Config, error) {
	overridden := cfg
	for i := 0; i < len(args); i++ {
		switch args[i] {
		case "--api-base":
			if i+1 >= len(args) {
				return cfg, fmt.Errorf("--api-base requires a value")
			}
			overridden.APIBase = args[i+1]
			i++
		case "--model":
			if i+1 >= len(args) {
				return cfg, fmt.Errorf("--model requires a value")
			}
			overridden.Model = args[i+1]
			i++
		case "--max-tokens":
			if i+1 >= len(args) {
				return cfg, fmt.Errorf("--max-tokens requires a value")
			}
			value, err := config.ParsePositiveIntForCLI(args[i+1], "--max-tokens")
			if err != nil {
				return cfg, err
			}
			overridden.MaxTokens = value
			i++
		default:
			return cfg, fmt.Errorf("unknown option: %s", args[i])
		}
	}
	return overridden, nil
}

func parseInstallArgs(args []string) (target string, dryRun bool, apply bool, err error) {
	for i := 0; i < len(args); i++ {
		switch args[i] {
		case "--dry-run":
			dryRun = true
		case "--apply":
			apply = true
		default:
			if strings.HasPrefix(args[i], "--") {
				return "", false, false, fmt.Errorf("unknown option: %s", args[i])
			}
			if target != "" {
				return "", false, false, fmt.Errorf("multiple install targets provided")
			}
			target = args[i]
		}
	}

	if dryRun == apply {
		return "", false, false, fmt.Errorf("usage: claude-code-go install [target] (--dry-run | --apply)")
	}

	if apply && target == "" {
		return "", false, false, fmt.Errorf("usage: claude-code-go install <target> --apply")
	}

	return target, dryRun, apply, nil
}

func parseUpdateArgs(args []string) (opts update.Options, err error) {
	for i := 0; i < len(args); i++ {
		switch args[i] {
		case "--source-binary":
			if i+1 >= len(args) {
				return opts, fmt.Errorf("--source-binary requires a value")
			}
			opts.SourceBinary = args[i+1]
			i++
		case "--source-url":
			if i+1 >= len(args) {
				return opts, fmt.Errorf("--source-url requires a value")
			}
			opts.SourceURL = args[i+1]
			i++
		case "--apply":
			opts.Apply = true
		default:
			if strings.HasPrefix(args[i], "--") {
				return opts, fmt.Errorf("unknown option: %s", args[i])
			}
			if opts.TargetArg != "" {
				return opts, fmt.Errorf("multiple update targets provided")
			}
			opts.TargetArg = args[i]
		}
	}

	if opts.SourceBinary == "" && opts.SourceURL == "" {
		return opts, fmt.Errorf("usage: claude-code-go update [target] (--source-binary <path> | --source-url <url>) [--apply]")
	}
	if opts.SourceBinary != "" && opts.SourceURL != "" {
		return opts, fmt.Errorf("use either --source-binary or --source-url, not both")
	}
	if opts.Apply && opts.TargetArg == "" {
		return opts, fmt.Errorf("usage: claude-code-go update <target> (--source-binary <path> | --source-url <url>) --apply")
	}

	return opts, nil
}

func parseSetupTokenArgs(args []string) (setuptoken.Options, error) {
	var opts setuptoken.Options
	for i := 0; i < len(args); i++ {
		switch args[i] {
		case "--token":
			if i+1 >= len(args) {
				return opts, fmt.Errorf("--token requires a value")
			}
			opts.Token = args[i+1]
			i++
		case "--write-env-file":
			if i+1 >= len(args) {
				return opts, fmt.Errorf("--write-env-file requires a value")
			}
			opts.WriteEnvFile = args[i+1]
			i++
		default:
			return opts, fmt.Errorf("unknown option: %s", args[i])
		}
	}
	return opts, nil
}

func parseAgentsArgs(args []string) (string, error) {
	var settingSources string
	for i := 0; i < len(args); i++ {
		switch args[i] {
		case "--setting-sources":
			if i+1 >= len(args) {
				return "", fmt.Errorf("--setting-sources requires a value")
			}
			settingSources = args[i+1]
			i++
		default:
			return "", fmt.Errorf("unknown option: %s", args[i])
		}
	}
	return settingSources, nil
}

func parsePluginInstallArgs(args []string) (plugin.InstallOptions, error) {
	var opts plugin.InstallOptions
	for i := 0; i < len(args); i++ {
		switch args[i] {
		case "--scope", "-s":
			if i+1 >= len(args) {
				return opts, fmt.Errorf("--scope requires a value")
			}
			opts.Scope = args[i+1]
			i++
		case "--version":
			if i+1 >= len(args) {
				return opts, fmt.Errorf("--version requires a value")
			}
			opts.Version = args[i+1]
			i++
		default:
			if strings.HasPrefix(args[i], "--") {
				return opts, fmt.Errorf("unknown option: %s", args[i])
			}
			if opts.Plugin != "" {
				return opts, fmt.Errorf("multiple plugin identifiers provided")
			}
			opts.Plugin = args[i]
		}
	}
	if opts.Plugin == "" {
		return opts, fmt.Errorf("usage: claude-code-go plugin install <plugin> [--scope <user|project|local>] [--version <version>]")
	}
	return opts, nil
}

func parsePluginUninstallArgs(args []string) (plugin.UninstallOptions, error) {
	var opts plugin.UninstallOptions
	for i := 0; i < len(args); i++ {
		switch args[i] {
		case "--scope", "-s":
			if i+1 >= len(args) {
				return opts, fmt.Errorf("--scope requires a value")
			}
			opts.Scope = args[i+1]
			i++
		default:
			if strings.HasPrefix(args[i], "--") {
				return opts, fmt.Errorf("unknown option: %s", args[i])
			}
			if opts.Plugin != "" {
				return opts, fmt.Errorf("multiple plugin identifiers provided")
			}
			opts.Plugin = args[i]
		}
	}
	if opts.Plugin == "" {
		return opts, fmt.Errorf("usage: claude-code-go plugin uninstall <plugin> [--scope <user|project|local>]")
	}
	return opts, nil
}

func parsePluginMarketplaceAddArgs(args []string) (plugin.MarketplaceAddOptions, error) {
	var opts plugin.MarketplaceAddOptions
	for i := 0; i < len(args); i++ {
		switch args[i] {
		case "--scope", "-s":
			if i+1 >= len(args) {
				return opts, fmt.Errorf("--scope requires a value")
			}
			opts.Scope = args[i+1]
			i++
		default:
			if strings.HasPrefix(args[i], "--") {
				return opts, fmt.Errorf("unknown option: %s", args[i])
			}
			if opts.Source != "" {
				return opts, fmt.Errorf("multiple marketplace sources provided")
			}
			opts.Source = args[i]
		}
	}
	if opts.Source == "" {
		return opts, fmt.Errorf("usage: claude-code-go plugin marketplace add <source> [--scope <user|project|local>]")
	}
	return opts, nil
}

func parseMCPAddArgs(args []string) (mcp.AddOptions, error) {
	opts := mcp.AddOptions{}
	var positionals []string
	for i := 0; i < len(args); i++ {
		switch args[i] {
		case "--":
			positionals = append(positionals, args[i+1:]...)
			i = len(args)
		case "--scope":
			if i+1 >= len(args) {
				return opts, fmt.Errorf("--scope requires a value")
			}
			opts.Scope = args[i+1]
			i++
		case "--transport":
			if i+1 >= len(args) {
				return opts, fmt.Errorf("--transport requires a value")
			}
			opts.Transport = args[i+1]
			i++
		case "--env":
			if i+1 >= len(args) {
				return opts, fmt.Errorf("--env requires a value")
			}
			parsed, err := mcp.ParseEnv([]string{args[i+1]})
			if err != nil {
				return opts, err
			}
			if opts.Env == nil {
				opts.Env = map[string]string{}
			}
			for k, v := range parsed {
				opts.Env[k] = v
			}
			i++
		case "--header":
			if i+1 >= len(args) {
				return opts, fmt.Errorf("--header requires a value")
			}
			parsed, err := mcp.ParseHeaders([]string{args[i+1]})
			if err != nil {
				return opts, err
			}
			if opts.Headers == nil {
				opts.Headers = map[string]string{}
			}
			for k, v := range parsed {
				opts.Headers[k] = v
			}
			i++
		case "--client-id":
			if i+1 >= len(args) {
				return opts, fmt.Errorf("--client-id requires a value")
			}
			opts.ClientID = args[i+1]
			i++
		case "--callback-port":
			if i+1 >= len(args) {
				return opts, fmt.Errorf("--callback-port requires a value")
			}
			port, err := mcp.ParsePositivePort(args[i+1])
			if err != nil {
				return opts, err
			}
			opts.CallbackPort = port
			i++
		default:
			if strings.HasPrefix(args[i], "--") {
				return opts, fmt.Errorf("unknown option: %s", args[i])
			}
			positionals = append(positionals, args[i])
		}
	}
	if len(positionals) < 2 {
		return opts, fmt.Errorf("usage: claude-code-go mcp add [--scope <scope>] [--transport <stdio|http|sse>] <name> <command-or-url> [args...]")
	}
	opts.Name = positionals[0]
	opts.Target = positionals[1]
	if len(positionals) > 2 {
		opts.Args = append([]string(nil), positionals[2:]...)
	}
	return opts, nil
}

func parseMCPRemoveArgs(args []string) (mcp.RemoveOptions, error) {
	var opts mcp.RemoveOptions
	for i := 0; i < len(args); i++ {
		switch args[i] {
		case "--scope":
			if i+1 >= len(args) {
				return opts, fmt.Errorf("--scope requires a value")
			}
			opts.Scope = args[i+1]
			i++
		default:
			if strings.HasPrefix(args[i], "--") {
				return opts, fmt.Errorf("unknown option: %s", args[i])
			}
			if opts.Name != "" {
				return opts, fmt.Errorf("multiple MCP names provided")
			}
			opts.Name = args[i]
		}
	}
	if opts.Name == "" {
		return opts, fmt.Errorf("usage: claude-code-go mcp remove <name> [--scope <scope>]")
	}
	return opts, nil
}

func printHelp() {
	fmt.Println(`claude-code-go

	Usage:
	  # Slice 1 bootstrap / config / install
	  claude-code-go auth login --api-key <token>
	  claude-code-go auth status
	  claude-code-go auth logout
	  claude-code-go config show
	  claude-code-go doctor
	  claude-code-go install [target] --dry-run
	  claude-code-go install <target> --apply
	  claude-code-go update [target] (--source-binary <path> | --source-url <url>) [--apply]
	  claude-code-go api payload [--api-base <url>] [--model <name>] [--max-tokens <n>]
	  claude-code-go api ping [--api-base <url>] [--model <name>] [--max-tokens <n>]

	  # Later slices already present on this branch
	  claude-code-go auto-mode defaults
	  claude-code-go auto-mode config
	  claude-code-go assistant [sessionId]
	  claude-code-go server [--port <number>] [--host <string>] [--auth-token <token>] [--unix <path>] [--workspace <dir>] [--idle-timeout <ms>] [--max-sessions <n>]
	  claude-code-go ssh <host> [dir] [--permission-mode <mode>] [--dangerously-skip-permissions] [--local]
  claude-code-go open <cc-url> [-p|--print [prompt]] [--output-format <format>] [--resume-session <sessionId>] [--stop-session <sessionId>]
  claude-code-go setup-token [--token <token>] [--write-env-file <path>]
  claude-code-go mcp list
  claude-code-go plugin list
  claude-code-go plugin install <plugin> [--scope <user|project|local>] [--version <version>]
  claude-code-go plugin uninstall <plugin> [--scope <user|project|local>]
  claude-code-go plugin marketplace add <source> [--scope <user|project|local>]
  claude-code-go plugin marketplace list
  claude-code-go plugin marketplace remove <name>
	  claude-code-go mcp get <name>
	  claude-code-go mcp add [--scope <scope>] [--transport <stdio|http|sse>] [--env KEY=value] [--header 'Key: value'] <name> <command-or-url> [args...]
	  claude-code-go mcp remove <name> [--scope <scope>]
	  claude-code-go agents [--setting-sources <sources>]

	  See docs/pr1-recovery-plan.md for the current review boundary.`)
}

func valueOrNone(v string) string {
	if v == "" {
		return "none"
	}
	return v
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}

func pathExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}
