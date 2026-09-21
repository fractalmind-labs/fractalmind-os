package config

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/robfig/cron/v3"
	"gopkg.in/yaml.v3"
)

var agentNamePattern = regexp.MustCompile(`^[a-zA-Z0-9_][a-zA-Z0-9_-]*$`)

// Config represents the main configuration.
type Config struct {
	Gateway  *GatewayConfig  `yaml:"gateway"`
	Channels *ChannelsConfig `yaml:"channels"`
	Agents   *AgentsConfig   `yaml:"agents"`
}

// GatewayConfig contains gateway settings.
type GatewayConfig struct {
	Port int    `yaml:"port"`
	Bind string `yaml:"bind"`
	// AllowedOrigins restricts WebSocket origins. Empty means allow all.
	AllowedOrigins []string `yaml:"allowedOrigins,omitempty"`
}

// ChannelsConfig contains channel configurations.
type ChannelsConfig struct {
	Telegram *TelegramConfig `yaml:"telegram,omitempty"`
	Feishu   *FeishuConfig   `yaml:"feishu,omitempty"`
	Slack    *SlackConfig    `yaml:"slack,omitempty"`
	Discord  *DiscordConfig  `yaml:"discord,omitempty"`
	IMessage *IMessageConfig `yaml:"imessage,omitempty"`
	Demail   *DemailConfig   `yaml:"demail,omitempty"`
	// Inbound controls gateway-level inbound message behavior shared across
	// every channel: acknowledgment before processing and milestone progress
	// reporting back through the inbound channel.
	Inbound *InboundConfig `yaml:"inbound,omitempty"`
}

// InboundConfig controls gateway-level inbound behavior that applies to all
// channels regardless of the agent runtime: send an acknowledgment before
// dispatching to an agent, and optionally stream milestone progress updates
// back through the inbound channel during processing.
type InboundConfig struct {
	// AckEnabled controls whether the gateway sends an acknowledgment back
	// through the inbound channel before dispatching to an agent runtime. A
	// nil value defaults to true so the behavior is on by default.
	AckEnabled *bool `yaml:"ackEnabled,omitempty"`
	// AckMessage is the acknowledgment text sent before processing. An empty
	// value lets the agent runtime supply its own default (typically
	// "处理中…").
	AckMessage string `yaml:"ackMessage,omitempty"`
}

// ackEnabled reports whether acknowledgment is enabled. A nil config or nil
// flag defaults to enabled so the behavior stays on by default.
func (c *InboundConfig) ackEnabled() bool {
	if c == nil || c.AckEnabled == nil {
		return true
	}
	return *c.AckEnabled
}

// ackMessage returns the configured acknowledgment text, or "" when unset so
// the caller can apply its own default.
func (c *InboundConfig) ackMessage() string {
	if c == nil {
		return ""
	}
	return strings.TrimSpace(c.AckMessage)
}

// TelegramConfig contains Telegram channel settings.
type TelegramConfig struct {
	Enabled      bool    `yaml:"enabled"`
	BotToken     string  `yaml:"botToken,omitempty"`
	AllowedUsers []int64 `yaml:"allowedUsers,omitempty"`
	AllowedChats []int64 `yaml:"allowedChats,omitempty"`
	AdminID      int64   `yaml:"adminID,omitempty"`

	// Mode controls how FractalBot receives Telegram updates.
	// Supported values: "polling", "webhook". Empty means auto.
	Mode string `yaml:"mode,omitempty"`

	// PollingTimeoutSeconds is the long polling timeout used by getUpdates().
	PollingTimeoutSeconds int `yaml:"pollingTimeoutSeconds,omitempty"`
	// PollingLimit is the maximum number of updates returned per request.
	PollingLimit int `yaml:"pollingLimit,omitempty"`
	// PollingOffsetFile persists the next update offset (UpdateID+1).
	PollingOffsetFile string `yaml:"pollingOffsetFile,omitempty"`

	// WebhookListenAddr is the local bind address for receiving webhooks.
	// Example: "0.0.0.0:18790".
	WebhookListenAddr string `yaml:"webhookListenAddr,omitempty"`
	// WebhookPath is the HTTP path mounted on the webhook server.
	// Default: "/telegram/webhook".
	WebhookPath string `yaml:"webhookPath,omitempty"`
	// WebhookPublicURL is the externally reachable HTTPS URL registered with Telegram.
	WebhookPublicURL string `yaml:"webhookPublicURL,omitempty"`
	// WebhookSecretToken is verified against X-Telegram-Bot-Api-Secret-Token.
	WebhookSecretToken string `yaml:"webhookSecretToken,omitempty"`
	// WebhookRegisterOnStart controls whether FractalBot registers the webhook on startup.
	WebhookRegisterOnStart bool `yaml:"webhookRegisterOnStart,omitempty"`
	// WebhookDeleteOnStop controls whether FractalBot deletes the webhook on shutdown.
	WebhookDeleteOnStop bool `yaml:"webhookDeleteOnStop,omitempty"`
}

// FeishuConfig contains Feishu/Lark channel settings.
type FeishuConfig struct {
	Enabled bool `yaml:"enabled"`
	// AppID from Feishu/Lark developer console.
	AppID string `yaml:"appId,omitempty"`
	// AppSecret from Feishu/Lark developer console.
	AppSecret string `yaml:"appSecret,omitempty"`
	// Domain selects Feishu (China) or Lark (International).
	// Supported values: "feishu", "lark". Defaults to "feishu".
	Domain string `yaml:"domain,omitempty"`
	// AllowedUsers is an allowlist of open_id or user_id values.
	AllowedUsers []string `yaml:"allowedUsers,omitempty"`
	// Bots configures additional Feishu application identities. Each entry is
	// an independently connected bot; the map key is an operator-chosen local
	// instance name, not a Feishu credential or recipient identity. The
	// top-level fields above remain the legacy singleton configuration.
	Bots map[string]FeishuBotConfig `yaml:"bots,omitempty"`
}

// FeishuBotConfig contains the credentials and local policy for one additional
// Feishu bot. Entries in FeishuConfig.Bots are enabled whenever the parent
// FeishuConfig is enabled.
type FeishuBotConfig struct {
	// AppID from Feishu/Lark developer console. It is also the normalized
	// inbound receiver_id for this bot.
	AppID string `yaml:"appId,omitempty"`
	// AppSecret from Feishu/Lark developer console.
	AppSecret string `yaml:"appSecret,omitempty"`
	// Domain selects Feishu (China) or Lark (International). Empty defaults to
	// "feishu".
	Domain string `yaml:"domain,omitempty"`
	// AllowedUsers is an allowlist of open_id or user_id values for this bot.
	AllowedUsers []string `yaml:"allowedUsers,omitempty"`
}

// SlackConfig contains Slack channel settings.
type SlackConfig struct {
	Enabled         bool     `yaml:"enabled,omitempty"`
	BotToken        string   `yaml:"botToken,omitempty"`
	AppToken        string   `yaml:"appToken,omitempty"`
	AllowedUsers    []string `yaml:"allowedUsers,omitempty"`
	AllowedChannels []string `yaml:"allowedChannels,omitempty"`
}

// DiscordConfig contains Discord channel settings.
type DiscordConfig struct {
	Enabled      bool     `yaml:"enabled,omitempty"`
	Token        string   `yaml:"token,omitempty"`
	AllowedUsers []string `yaml:"allowedUsers,omitempty"`
}

// IMessageConfig contains iMessage channel settings.
type IMessageConfig struct {
	Enabled bool `yaml:"enabled,omitempty"`
	// Recipient is the default iMessage target (email/phone/Apple ID handle).
	Recipient string `yaml:"recipient,omitempty"`
	// Message is the fallback text used when API/CLI send text is empty.
	Message string `yaml:"message,omitempty"`
	// Service defaults to "E:iMessage" when empty.
	Service string `yaml:"service,omitempty"`
	// PollingEnabled controls whether inbound iMessage polling is enabled.
	PollingEnabled bool `yaml:"pollingEnabled,omitempty"`
	// PollingIntervalSeconds sets polling interval. Default: 5.
	PollingIntervalSeconds int `yaml:"pollingIntervalSeconds,omitempty"`
	// PollingLimit caps number of messages fetched per poll. Default: 20.
	PollingLimit int `yaml:"pollingLimit,omitempty"`
	// DatabasePath overrides Messages DB path. Default: ~/Library/Messages/chat.db.
	DatabasePath string `yaml:"databasePath,omitempty"`
}

// DemailConfig contains fractal-demail (on-chain agent mail on Sui) settings.
type DemailConfig struct {
	Enabled bool `yaml:"enabled,omitempty"`
	// RPCURL is the Sui JSON-RPC endpoint (e.g. https://fullnode.testnet.sui.io:443).
	RPCURL string `yaml:"rpcUrl,omitempty"`
	// PackageID is the fractal-demail Move package id.
	PackageID string `yaml:"packageId,omitempty"`
	// Address is this node's Sui address (inbound recipient / outbound sender).
	Address string `yaml:"address,omitempty"`
	// IdentityKeyFile is a path to a file containing the node's base64 Ed25519
	// private key (32-byte seed or 64-byte key). Read at channel start; never logged.
	IdentityKeyFile string `yaml:"identityKeyFile,omitempty"`
	// SponsorAddress is the gas sponsor Sui address for outbound sends.
	// It may equal Address (self-sponsored: the node pays its own gas with a
	// single signature); a distinct sponsor uses the dual-signature route.
	SponsorAddress string `yaml:"sponsorAddress,omitempty"`
	// GasCoin is the sponsor-owned gas coin object id for outbound sends.
	GasCoin string `yaml:"gasCoin,omitempty"`
	// PollIntervalSeconds controls inbound event polling. Default: 2.
	PollIntervalSeconds int `yaml:"pollIntervalSeconds,omitempty"`
	// CursorFile persists processed Message object ids to prevent replay on restart.
	CursorFile string `yaml:"cursorFile,omitempty"`
	// AllowedSenders is an allowlist of sender Sui addresses. Empty means deny all.
	AllowedSenders []string `yaml:"allowedSenders,omitempty"`
	// Peers maps a recipient Sui address to its base64 Ed25519 public key.
	// Required per outbound recipient: a public key cannot be derived from a Sui address.
	Peers map[string]string `yaml:"peers,omitempty"`
}

// OhMyCodeConfig contains integration settings for the oh-my-code workspace.
// The top-level workspace settings remain the legacy fallback for inbound
// messages that do not match a named receiver target.
type OhMyCodeConfig struct {
	Enabled bool `yaml:"enabled,omitempty"`

	// Workspace is the path to the oh-my-code repository.
	// Example: "/home/elliot245/workspace/elliot245/oh-my-code".
	Workspace string `yaml:"workspace,omitempty"`

	// AgentManagerScript is the path (relative to Workspace or absolute) to the agent-manager entrypoint.
	// Default: ".claude/skills/agent-manager/scripts/main.py".
	AgentManagerScript string `yaml:"agentManagerScript,omitempty"`

	// DefaultAgent is the logical agent name to assign tasks to when a channel
	// message is received. This is not a physical tmux session name; for
	// example, a namespaced agent-manager session "xiaoyi--main" is addressed
	// as "main" here.
	DefaultAgent string `yaml:"defaultAgent,omitempty"`

	// AllowedAgents restricts which agents can be targeted by Telegram messages.
	// If empty, only DefaultAgent is allowed.
	AllowedAgents []string `yaml:"allowedAgents,omitempty"`

	// AssignTimeoutSeconds limits how long we wait for agent-manager output.
	AssignTimeoutSeconds int `yaml:"assignTimeoutSeconds,omitempty"`

	// Targets maps a stable, operator-chosen target name to a receiver-aware
	// oh-my-code destination. A channel adapter supplies the normalized channel
	// and receiver_id; scoped receiver matches take precedence over the legacy
	// channel-agnostic receiverIds matches before the top-level fallback is used.
	Targets map[string]OhMyCodeTargetConfig `yaml:"targets,omitempty"`
}

// OhMyCodeTargetConfig describes one receiver-identity destination.
type OhMyCodeTargetConfig struct {
	// ReceiverIDs are legacy, channel-agnostic inbound receiver identities.
	// They remain supported for backward compatibility, but receivers should be
	// used for new configurations so an identity shared by two channel types
	// cannot collide.
	ReceiverIDs []string `yaml:"receiverIds,omitempty"`
	// Receivers are channel-scoped inbound receiver identities. The pair of
	// channel and receiverId uniquely selects this target.
	Receivers []ReceiverTargetConfig `yaml:"receivers,omitempty"`

	// Workspace is the path to the target oh-my-code repository.
	Workspace string `yaml:"workspace,omitempty"`

	// AgentManagerScript is relative to Workspace or absolute within it.
	// Empty uses the standard agent-manager entrypoint.
	AgentManagerScript string `yaml:"agentManagerScript,omitempty"`

	// DefaultAgent is used when the inbound channel did not explicitly select an
	// agent. AllowedAgents, when non-empty, restricts explicit selections.
	DefaultAgent  string   `yaml:"defaultAgent,omitempty"`
	AllowedAgents []string `yaml:"allowedAgents,omitempty"`

	// AssignTimeoutSeconds limits the target-specific assignment wait.
	AssignTimeoutSeconds int `yaml:"assignTimeoutSeconds,omitempty"`
}

// ReceiverTargetConfig binds one normalized channel + receiver identity pair
// to an OhMyCode target. Both values are opaque identifiers supplied by the
// corresponding channel adapter.
type ReceiverTargetConfig struct {
	Channel    string `yaml:"channel,omitempty"`
	ReceiverID string `yaml:"receiverId,omitempty"`
}

// CodexAppCDPConfig contains routing settings for a Codex App-managed agent.
type CodexAppCDPConfig struct {
	Enabled bool `yaml:"enabled,omitempty"`

	// CDPEndpoint is the Chromium DevTools HTTP endpoint exposed by Codex App.
	// Example: "http://127.0.0.1:9222".
	CDPEndpoint string `yaml:"cdpEndpoint,omitempty"`

	// TargetSelector matches the CDP target title or URL. Empty selects the first page target.
	TargetSelector string `yaml:"targetSelector,omitempty"`

	// HostID is the Codex App host id used by the in-app app-server manager. Defaults to "local".
	HostID string `yaml:"hostId,omitempty"`

	// ConversationID optionally pins delivery to a Codex App local conversation.
	// If empty, the CDP bridge extracts the active /local/<conversationId> route.
	ConversationID string `yaml:"conversationId,omitempty"`

	// TargetProject resolves the Codex App conversation dynamically by project
	// and named session. ConversationID, when set, remains an explicit override.
	TargetProject CodexAppCDPTargetProjectConfig `yaml:"targetProject,omitempty"`

	// InboxPath is a durable file-backed inbox used as the MVP queue and CDP fallback.
	InboxPath string `yaml:"inboxPath,omitempty"`

	// FallbackToInbox queues to InboxPath when CDP delivery fails.
	FallbackToInbox bool `yaml:"fallbackToInbox,omitempty"`

	// DefaultAgent is the agent name used when the inbound message omits /agent.
	DefaultAgent string `yaml:"defaultAgent,omitempty"`

	// AllowedAgents restricts which agents can be targeted by channel messages.
	// If empty, only DefaultAgent is allowed.
	AllowedAgents []string `yaml:"allowedAgents,omitempty"`

	// DeliveryTimeoutSeconds limits CDP delivery time. Defaults to 20 seconds.
	DeliveryTimeoutSeconds int `yaml:"deliveryTimeoutSeconds,omitempty"`

	// RepairPolicy controls what the gateway may do when CDP is unavailable.
	// Supported values: "off", "status-only", "new-instance", "relaunch".
	// Empty defaults to "relaunch" when Codex App CDP is enabled.
	RepairPolicy string `yaml:"repairPolicy,omitempty"`

	// CheckOnIncomingMessage controls whether inbound Codex App routes check CDP
	// readiness before delivery. Nil defaults to true.
	CheckOnIncomingMessage *bool `yaml:"checkOnIncomingMessage,omitempty"`

	// Watch periodically checks CDP readiness while the gateway is running.
	Watch CodexAppCDPWatchConfig `yaml:"watch,omitempty"`
}

// CodexAppCDPTargetProjectConfig describes a stable logical Codex App target.
type CodexAppCDPTargetProjectConfig struct {
	// Name is an optional display alias used when CWD is not configured.
	Name string `yaml:"name,omitempty"`

	// CWD is the project working directory. Exact CWD match is preferred.
	CWD string `yaml:"cwd,omitempty"`

	// Session is the named Codex App session, for example "main".
	Session string `yaml:"session,omitempty"`

	// StateDB optionally pins the Codex App state sqlite DB for resolution.
	// Empty defaults to the newest ~/.codex/state_*.sqlite.
	StateDB string `yaml:"stateDb,omitempty"`
}

// CodexAppCDPWatchConfig controls the long-running Codex App CDP watchdog.
type CodexAppCDPWatchConfig struct {
	// Enabled controls the watchdog. Nil defaults to true when Codex App CDP is enabled.
	Enabled *bool `yaml:"enabled,omitempty"`

	// IntervalSeconds sets the watchdog interval. Defaults to 60 when watch is enabled.
	IntervalSeconds int `yaml:"intervalSeconds,omitempty"`

	// CooldownSeconds prevents repeated repair attempts. Defaults to 90.
	CooldownSeconds int `yaml:"cooldownSeconds,omitempty"`
}

// ClaudeDesktopConfig contains routing settings for Claude Desktop delivery.
// FractalBot only uses an already-authenticated Claude chat target exposed by
// CDP. It does not launch, patch, or otherwise bypass Claude Desktop.
type ClaudeDesktopConfig struct {
	Enabled bool `yaml:"enabled,omitempty"`

	// CDPEndpoint is the Chromium DevTools endpoint exposed by Claude Desktop.
	// Example: "http://127.0.0.1:19334".
	CDPEndpoint string `yaml:"cdpEndpoint,omitempty"`

	// TargetSelector optionally matches a Claude chat target title or URL.
	TargetSelector string `yaml:"targetSelector,omitempty"`

	// InboxPath is a durable queue used when CDP delivery is unavailable.
	InboxPath string `yaml:"inboxPath,omitempty"`

	// FallbackToInbox queues to InboxPath when CDP delivery fails.
	FallbackToInbox bool `yaml:"fallbackToInbox,omitempty"`

	// DefaultAgent is used when the inbound message omits /agent.
	DefaultAgent string `yaml:"defaultAgent,omitempty"`

	// AllowedAgents restricts which agents can be targeted by channel messages.
	AllowedAgents []string `yaml:"allowedAgents,omitempty"`

	// DeliveryTimeoutSeconds limits CDP delivery. Defaults to 20 seconds.
	DeliveryTimeoutSeconds int `yaml:"deliveryTimeoutSeconds,omitempty"`
}

// HeartbeatConfig schedules runtime-neutral agent wakeups.
type HeartbeatConfig struct {
	Enabled       bool                 `yaml:"enabled,omitempty"`
	StatePath     string               `yaml:"statePath,omitempty"`
	MaxConcurrent int                  `yaml:"maxConcurrent,omitempty"`
	Jobs          []HeartbeatJobConfig `yaml:"jobs,omitempty"`
}

// HeartbeatJobConfig targets one Agent Runtime and agent on a cron schedule.
type HeartbeatJobConfig struct {
	ID                 string            `yaml:"id"`
	Runtime            string            `yaml:"runtime"`
	Agent              string            `yaml:"agent"`
	Text               string            `yaml:"text"`
	Cron               string            `yaml:"cron"`
	Timezone           string            `yaml:"timezone"`
	AgentCronProfiles  map[string]string `yaml:"agentCronProfiles,omitempty"`
	ResetCronOnInbound bool              `yaml:"resetCronOnInbound,omitempty"`
}

// AgentsConfig contains gateway-side agent routing settings.
type AgentsConfig struct {
	Workspace     string               `yaml:"workspace"`
	MaxConcurrent int                  `yaml:"maxConcurrent"`
	Router        string               `yaml:"router,omitempty"`
	OhMyCode      *OhMyCodeConfig      `yaml:"ohMyCode,omitempty"`
	CodexAppCDP   *CodexAppCDPConfig   `yaml:"codexAppCDP,omitempty"`
	ClaudeDesktop *ClaudeDesktopConfig `yaml:"claudeDesktop,omitempty"`
	Heartbeat     *HeartbeatConfig     `yaml:"heartbeat,omitempty"`
}

// ResolveConfigPath returns the config file path using this priority:
//  1. flagValue (if non-empty, i.e. --config was explicitly provided)
//  2. $FRACTALBOT_CONFIG environment variable
//  3. ~/.config/fractalbot/config.yaml (XDG-style default)
//  4. ./config.yaml (legacy fallback)
func ResolveConfigPath(flagValue string) string {
	if flagValue != "" {
		return flagValue
	}

	if env := os.Getenv("FRACTALBOT_CONFIG"); env != "" {
		return env
	}

	home, err := os.UserHomeDir()
	if err == nil {
		xdg := filepath.Join(home, ".config", "fractalbot", "config.yaml")
		if _, err := os.Stat(xdg); err == nil {
			return xdg
		}
	}

	return "./config.yaml"
}

// LoadConfig loads configuration from file.
func LoadConfig(path string) (*Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("failed to read config: %w", err)
	}

	var config Config
	if err := yaml.Unmarshal(data, &config); err != nil {
		return nil, fmt.Errorf("failed to parse config: %w", err)
	}
	if err := validateConfig(&config); err != nil {
		return nil, err
	}

	return &config, nil
}

// SaveConfig saves configuration to file.
func SaveConfig(config *Config, path string) error {
	data, err := yaml.Marshal(config)
	if err != nil {
		return fmt.Errorf("failed to marshal config: %w", err)
	}

	if err := os.WriteFile(path, data, 0644); err != nil {
		return fmt.Errorf("failed to write config: %w", err)
	}

	return nil
}

// DefaultConfig returns default configuration.
func DefaultConfig() *Config {
	return &Config{
		Gateway: &GatewayConfig{
			Port: 18789,
			Bind: "127.0.0.1",
		},
		Channels: &ChannelsConfig{
			Telegram: &TelegramConfig{
				Enabled: false,
			},
		},
		Agents: &AgentsConfig{
			Workspace:     "./workspace",
			MaxConcurrent: 4,
		},
	}
}

func validateConfig(cfg *Config) error {
	if err := validateFeishuConfig(cfg); err != nil {
		return err
	}
	if err := validateRouterConfig(cfg); err != nil {
		return err
	}
	if err := validateOhMyCodeConfig(cfg); err != nil {
		return err
	}
	if err := validateCodexAppCDPConfig(cfg); err != nil {
		return err
	}
	if err := validateClaudeDesktopConfig(cfg); err != nil {
		return err
	}
	if err := validateHeartbeatConfig(cfg); err != nil {
		return err
	}
	return nil
}

func validateFeishuConfig(cfg *Config) error {
	if cfg == nil || cfg.Channels == nil || cfg.Channels.Feishu == nil {
		return nil
	}
	feishu := cfg.Channels.Feishu
	if !feishu.Enabled {
		return nil
	}

	legacyAppID := strings.TrimSpace(feishu.AppID)
	legacySecret := strings.TrimSpace(feishu.AppSecret)
	if (legacyAppID == "") != (legacySecret == "") {
		return fmt.Errorf("channels.feishu.appId and channels.feishu.appSecret must be configured together")
	}
	if legacyAppID == "" && len(feishu.Bots) == 0 {
		return fmt.Errorf("channels.feishu.appId and channels.feishu.appSecret are required when feishu is enabled unless channels.feishu.bots is configured")
	}

	seenAppIDs := make(map[string]string)
	if legacyAppID != "" {
		if err := validateFeishuDomain(feishu.Domain); err != nil {
			return fmt.Errorf("channels.feishu.domain: %w", err)
		}
		seenAppIDs[legacyAppID] = "channels.feishu"
	}

	botNames := make([]string, 0, len(feishu.Bots))
	for name := range feishu.Bots {
		botNames = append(botNames, name)
	}
	sort.Strings(botNames)
	for _, name := range botNames {
		if strings.TrimSpace(name) != name || name == "" {
			return fmt.Errorf("channels.feishu.bots: bot name is required and must not contain surrounding whitespace")
		}
		if err := validateAgentName(name); err != nil {
			return fmt.Errorf("channels.feishu.bots[%q]: %w", name, err)
		}

		bot := feishu.Bots[name]
		appID := strings.TrimSpace(bot.AppID)
		if appID == "" {
			return fmt.Errorf("channels.feishu.bots[%q].appId: required", name)
		}
		if strings.TrimSpace(bot.AppSecret) == "" {
			return fmt.Errorf("channels.feishu.bots[%q].appSecret: required", name)
		}
		if owner, exists := seenAppIDs[appID]; exists {
			return fmt.Errorf("channels.feishu.bots[%q].appId: app ID is already configured by %s", name, owner)
		}
		if err := validateFeishuDomain(bot.Domain); err != nil {
			return fmt.Errorf("channels.feishu.bots[%q].domain: %w", name, err)
		}
		seenAppIDs[appID] = fmt.Sprintf("channels.feishu.bots[%q]", name)
	}
	return nil
}

func validateFeishuDomain(raw string) error {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "", "feishu", "lark":
		return nil
	default:
		return fmt.Errorf("unsupported domain %q", raw)
	}
}

func validateRouterConfig(cfg *Config) error {
	if cfg == nil || cfg.Agents == nil {
		return nil
	}
	router := strings.TrimSpace(cfg.Agents.Router)
	if router == "" || router == "ohMyCode" || router == "codexAppCDP" || router == "claudeDesktop" {
		return nil
	}
	return fmt.Errorf("agents.router: unsupported router %q", router)
}

func validateClaudeDesktopConfig(cfg *Config) error {
	if cfg == nil || cfg.Agents == nil || cfg.Agents.ClaudeDesktop == nil {
		return nil
	}
	claude := cfg.Agents.ClaudeDesktop
	if err := validateRoutingAgents("agents.claudeDesktop", claude.DefaultAgent, claude.AllowedAgents); err != nil {
		return err
	}
	if !claude.Enabled {
		return nil
	}
	if strings.TrimSpace(claude.CDPEndpoint) == "" && strings.TrimSpace(claude.InboxPath) == "" {
		return fmt.Errorf("agents.claudeDesktop.cdpEndpoint or agents.claudeDesktop.inboxPath: required when agents.claudeDesktop.enabled is true")
	}
	if claude.DeliveryTimeoutSeconds < 0 {
		return fmt.Errorf("agents.claudeDesktop.deliveryTimeoutSeconds: must be >= 0")
	}
	return nil
}

func validateHeartbeatConfig(cfg *Config) error {
	if cfg == nil || cfg.Agents == nil || cfg.Agents.Heartbeat == nil {
		return nil
	}
	heartbeat := cfg.Agents.Heartbeat
	if heartbeat.MaxConcurrent < 0 {
		return fmt.Errorf("agents.heartbeat.maxConcurrent: must be >= 0")
	}
	if !heartbeat.Enabled {
		return nil
	}
	if len(heartbeat.Jobs) == 0 {
		return fmt.Errorf("agents.heartbeat.jobs: at least one job is required when heartbeat is enabled")
	}

	seenIDs := make(map[string]struct{}, len(heartbeat.Jobs))
	for idx := range heartbeat.Jobs {
		job := &heartbeat.Jobs[idx]
		prefix := fmt.Sprintf("agents.heartbeat.jobs[%d]", idx)
		job.ID = strings.TrimSpace(job.ID)
		job.Runtime = strings.TrimSpace(job.Runtime)
		job.Agent = strings.TrimSpace(job.Agent)
		job.Text = strings.TrimSpace(job.Text)
		job.Cron = strings.TrimSpace(job.Cron)
		job.Timezone = strings.TrimSpace(job.Timezone)

		if job.ID == "" {
			return fmt.Errorf("%s.id: required", prefix)
		}
		if err := validateAgentName(job.ID); err != nil {
			return fmt.Errorf("%s.id: %w", prefix, err)
		}
		if _, exists := seenIDs[job.ID]; exists {
			return fmt.Errorf("%s.id: duplicate heartbeat job %q", prefix, job.ID)
		}
		seenIDs[job.ID] = struct{}{}

		if job.Agent == "" {
			return fmt.Errorf("%s.agent: required", prefix)
		}
		if err := validateAgentName(job.Agent); err != nil {
			return fmt.Errorf("%s.agent: %w", prefix, err)
		}
		if job.Text == "" {
			return fmt.Errorf("%s.text: required", prefix)
		}
		if job.Cron == "" {
			return fmt.Errorf("%s.cron: required", prefix)
		}
		if job.Timezone == "" {
			return fmt.Errorf("%s.timezone: required", prefix)
		}
		if _, err := time.LoadLocation(job.Timezone); err != nil {
			return fmt.Errorf("%s.timezone: %w", prefix, err)
		}
		if _, err := parseHeartbeatCron(job.Cron, job.Timezone); err != nil {
			return fmt.Errorf("%s.cron: %w", prefix, err)
		}
		if err := validateHeartbeatRuntimeTarget(cfg.Agents, job.Runtime, job.Agent); err != nil {
			return fmt.Errorf("%s.runtime: %w", prefix, err)
		}

		normalizedProfiles := make(map[string]string, len(job.AgentCronProfiles))
		for rawProfile, rawExpression := range job.AgentCronProfiles {
			profile := strings.TrimSpace(rawProfile)
			expression := strings.TrimSpace(rawExpression)
			if profile == "" {
				return fmt.Errorf("%s.agentCronProfiles: profile name is required", prefix)
			}
			if err := validateAgentName(profile); err != nil {
				return fmt.Errorf("%s.agentCronProfiles[%q]: %w", prefix, profile, err)
			}
			if expression == "" {
				return fmt.Errorf("%s.agentCronProfiles[%q]: cron expression is required", prefix, profile)
			}
			if _, err := parseHeartbeatCron(expression, job.Timezone); err != nil {
				return fmt.Errorf("%s.agentCronProfiles[%q]: %w", prefix, profile, err)
			}
			if _, exists := normalizedProfiles[profile]; exists {
				return fmt.Errorf("%s.agentCronProfiles: duplicate profile %q", prefix, profile)
			}
			normalizedProfiles[profile] = expression
		}
		job.AgentCronProfiles = normalizedProfiles
	}
	return nil
}

func parseHeartbeatCron(expression, timezone string) (cron.Schedule, error) {
	return cron.ParseStandard("CRON_TZ=" + strings.TrimSpace(timezone) + " " + strings.TrimSpace(expression))
}

func validateHeartbeatRuntimeTarget(agents *AgentsConfig, runtimeName, agentName string) error {
	switch runtimeName {
	case "ohMyCode":
		if agents.OhMyCode == nil || !agents.OhMyCode.Enabled {
			return fmt.Errorf("ohMyCode runtime is not enabled")
		}
		return validateHeartbeatAgentAllowed("agents.ohMyCode", agentName, agents.OhMyCode.DefaultAgent, agents.OhMyCode.AllowedAgents)
	case "codexAppCDP":
		if agents.CodexAppCDP == nil || !agents.CodexAppCDP.Enabled {
			return fmt.Errorf("codexAppCDP runtime is not enabled")
		}
		return validateHeartbeatAgentAllowed("agents.codexAppCDP", agentName, agents.CodexAppCDP.DefaultAgent, agents.CodexAppCDP.AllowedAgents)
	case "claudeDesktop":
		if agents.ClaudeDesktop == nil || !agents.ClaudeDesktop.Enabled {
			return fmt.Errorf("claudeDesktop runtime is not enabled")
		}
		return validateHeartbeatAgentAllowed("agents.claudeDesktop", agentName, agents.ClaudeDesktop.DefaultAgent, agents.ClaudeDesktop.AllowedAgents)
	default:
		return fmt.Errorf("unsupported runtime %q", runtimeName)
	}
}

func validateHeartbeatAgentAllowed(prefix, agentName, defaultAgent string, allowedAgents []string) error {
	if len(allowedAgents) == 0 {
		if strings.TrimSpace(defaultAgent) != agentName {
			return fmt.Errorf("agent %q is not allowed by %s", agentName, prefix)
		}
		return nil
	}
	for _, allowed := range allowedAgents {
		if strings.TrimSpace(allowed) == agentName {
			return nil
		}
	}
	return fmt.Errorf("agent %q is not allowed by %s.allowedAgents", agentName, prefix)
}

func validateOhMyCodeConfig(cfg *Config) error {
	if cfg == nil || cfg.Agents == nil || cfg.Agents.OhMyCode == nil {
		return nil
	}
	ohMyCode := cfg.Agents.OhMyCode
	if err := validateRoutingAgents("agents.ohMyCode", ohMyCode.DefaultAgent, ohMyCode.AllowedAgents); err != nil {
		return err
	}

	if !ohMyCode.Enabled {
		return nil
	}

	legacyWorkspace := strings.TrimSpace(ohMyCode.Workspace)
	if legacyWorkspace == "" && len(ohMyCode.Targets) == 0 {
		return fmt.Errorf("agents.ohMyCode.workspace: required when agents.ohMyCode.enabled is true")
	}
	if legacyWorkspace == "" && strings.TrimSpace(ohMyCode.AgentManagerScript) != "" {
		return fmt.Errorf("agents.ohMyCode.agentManagerScript: requires agents.ohMyCode.workspace")
	}
	if legacyWorkspace != "" {
		if err := validateOhMyCodeWorkspaceAndScript("agents.ohMyCode", legacyWorkspace, ohMyCode.AgentManagerScript); err != nil {
			return err
		}
	}

	if len(ohMyCode.Targets) == 0 {
		return nil
	}

	targetNames := make([]string, 0, len(ohMyCode.Targets))
	for name := range ohMyCode.Targets {
		targetNames = append(targetNames, name)
	}
	sort.Strings(targetNames)

	legacyReceiverOwners := make(map[string]string)
	scopedReceiverOwners := make(map[string]string)
	for _, name := range targetNames {
		if strings.TrimSpace(name) != name || name == "" {
			return fmt.Errorf("agents.ohMyCode.targets: target name is required and must not contain surrounding whitespace")
		}
		if err := validateAgentName(name); err != nil {
			return fmt.Errorf("agents.ohMyCode.targets[%q]: %w", name, err)
		}

		target := ohMyCode.Targets[name]
		prefix := fmt.Sprintf("agents.ohMyCode.targets[%q]", name)
		if len(target.ReceiverIDs) == 0 && len(target.Receivers) == 0 {
			return fmt.Errorf("%s.receiverIds or %s.receivers: at least one receiver identity is required", prefix, prefix)
		}
		for idx, rawReceiverID := range target.ReceiverIDs {
			receiverID := strings.TrimSpace(rawReceiverID)
			if receiverID == "" {
				return fmt.Errorf("%s.receiverIds[%d]: receiver identity is required", prefix, idx)
			}
			if owner, exists := legacyReceiverOwners[receiverID]; exists {
				return fmt.Errorf("%s.receiverIds[%d]: receiver identity is already configured by target %q", prefix, idx, owner)
			}
			if owner, exists := scopedReceiverOwnerForID(scopedReceiverOwners, receiverID); exists {
				return fmt.Errorf("%s.receiverIds[%d]: receiver identity conflicts with channel-scoped receiver configured by target %q", prefix, idx, owner)
			}
			legacyReceiverOwners[receiverID] = name
		}

		for idx, receiver := range target.Receivers {
			channel := normalizeReceiverChannel(receiver.Channel)
			receiverID := strings.TrimSpace(receiver.ReceiverID)
			if channel == "" {
				return fmt.Errorf("%s.receivers[%d].channel: required", prefix, idx)
			}
			if receiverID == "" {
				return fmt.Errorf("%s.receivers[%d].receiverId: required", prefix, idx)
			}
			if owner, exists := legacyReceiverOwners[receiverID]; exists {
				return fmt.Errorf("%s.receivers[%d].receiverId: receiver identity conflicts with legacy receiverIds configured by target %q", prefix, idx, owner)
			}
			key := scopedReceiverKey(channel, receiverID)
			if owner, exists := scopedReceiverOwners[key]; exists {
				return fmt.Errorf("%s.receivers[%d]: channel and receiver identity are already configured by target %q", prefix, idx, owner)
			}
			scopedReceiverOwners[key] = name
		}

		if err := validateRoutingAgents(prefix, target.DefaultAgent, target.AllowedAgents); err != nil {
			return err
		}
		if err := validateOhMyCodeWorkspaceAndScript(prefix, target.Workspace, target.AgentManagerScript); err != nil {
			return err
		}
	}

	return nil
}

// FindOhMyCodeTarget resolves a receiver destination deterministically. New
// channel-scoped receiver bindings are preferred, while receiverIds continues
// to provide the original channel-agnostic compatibility behavior.
func FindOhMyCodeTarget(ohMyCode *OhMyCodeConfig, channel, receiverID string) (string, OhMyCodeTargetConfig, bool) {
	if ohMyCode == nil {
		return "", OhMyCodeTargetConfig{}, false
	}
	receiverID = strings.TrimSpace(receiverID)
	if receiverID == "" || len(ohMyCode.Targets) == 0 {
		return "", OhMyCodeTargetConfig{}, false
	}
	channel = normalizeReceiverChannel(channel)
	targetNames := sortedOhMyCodeTargetNames(ohMyCode.Targets)

	if channel != "" {
		for _, name := range targetNames {
			target := ohMyCode.Targets[name]
			for _, receiver := range target.Receivers {
				if channel == normalizeReceiverChannel(receiver.Channel) && receiverID == strings.TrimSpace(receiver.ReceiverID) {
					return name, target, true
				}
			}
		}
	}

	for _, name := range targetNames {
		target := ohMyCode.Targets[name]
		for _, configuredID := range target.ReceiverIDs {
			if receiverID == strings.TrimSpace(configuredID) {
				return name, target, true
			}
		}
	}
	return "", OhMyCodeTargetConfig{}, false
}

func sortedOhMyCodeTargetNames(targets map[string]OhMyCodeTargetConfig) []string {
	targetNames := make([]string, 0, len(targets))
	for name := range targets {
		targetNames = append(targetNames, name)
	}
	sort.Strings(targetNames)
	return targetNames
}

func normalizeReceiverChannel(channel string) string {
	return strings.ToLower(strings.TrimSpace(channel))
}

func scopedReceiverKey(channel, receiverID string) string {
	return channel + "\x00" + receiverID
}

func scopedReceiverOwnerForID(owners map[string]string, receiverID string) (string, bool) {
	for key, owner := range owners {
		if strings.HasSuffix(key, "\x00"+receiverID) {
			return owner, true
		}
	}
	return "", false
}

func validateOhMyCodeWorkspaceAndScript(prefix, workspace, script string) error {
	workspace = strings.TrimSpace(workspace)
	if workspace == "" {
		return fmt.Errorf("%s.workspace: required when agents.ohMyCode.enabled is true", prefix)
	}

	script = strings.TrimSpace(script)
	if script == "" {
		return nil
	}
	if !filepath.IsAbs(workspace) {
		if filepath.IsAbs(script) {
			return fmt.Errorf("%s.agentManagerScript: must be relative when %s.workspace is relative", prefix, prefix)
		}
		if rel := filepath.Clean(script); rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
			return fmt.Errorf("%s.agentManagerScript: must not escape %s.workspace", prefix, prefix)
		}
		return nil
	}

	resolvedScript := script
	if !filepath.IsAbs(resolvedScript) {
		resolvedScript = filepath.Join(workspace, resolvedScript)
	}
	rel, err := filepath.Rel(workspace, resolvedScript)
	if err != nil {
		return fmt.Errorf("%s.agentManagerScript: must be within %s.workspace", prefix, prefix)
	}
	rel = filepath.Clean(rel)
	if rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return fmt.Errorf("%s.agentManagerScript: must be within %s.workspace", prefix, prefix)
	}

	return nil
}

func validateCodexAppCDPConfig(cfg *Config) error {
	if cfg == nil || cfg.Agents == nil || cfg.Agents.CodexAppCDP == nil {
		return nil
	}
	codex := cfg.Agents.CodexAppCDP
	if err := validateRoutingAgents("agents.codexAppCDP", codex.DefaultAgent, codex.AllowedAgents); err != nil {
		return err
	}
	if !codex.Enabled {
		return nil
	}
	if strings.TrimSpace(codex.CDPEndpoint) == "" && strings.TrimSpace(codex.InboxPath) == "" {
		return fmt.Errorf("agents.codexAppCDP.cdpEndpoint or agents.codexAppCDP.inboxPath: required when agents.codexAppCDP.enabled is true")
	}
	if codex.DeliveryTimeoutSeconds < 0 {
		return fmt.Errorf("agents.codexAppCDP.deliveryTimeoutSeconds: must be >= 0")
	}
	switch strings.TrimSpace(codex.RepairPolicy) {
	case "", "off", "status-only", "new-instance", "relaunch":
	default:
		return fmt.Errorf("agents.codexAppCDP.repairPolicy: unsupported policy %q", codex.RepairPolicy)
	}
	if codex.Watch.IntervalSeconds < 0 {
		return fmt.Errorf("agents.codexAppCDP.watch.intervalSeconds: must be >= 0")
	}
	if codex.Watch.CooldownSeconds < 0 {
		return fmt.Errorf("agents.codexAppCDP.watch.cooldownSeconds: must be >= 0")
	}
	return nil
}

func validateRoutingAgents(prefix, defaultAgent string, allowedAgents []string) error {
	defaultAgent = strings.TrimSpace(defaultAgent)
	if defaultAgent != "" {
		if err := validateAgentName(defaultAgent); err != nil {
			return fmt.Errorf("%s.defaultAgent: %w", prefix, err)
		}
	}

	allowed := make(map[string]struct{})
	for idx, name := range allowedAgents {
		trimmed := strings.TrimSpace(name)
		if trimmed == "" {
			return fmt.Errorf("%s.allowedAgents[%d]: agent name is required", prefix, idx)
		}
		if err := validateAgentName(trimmed); err != nil {
			return fmt.Errorf("%s.allowedAgents[%d]: %w", prefix, idx, err)
		}
		allowed[trimmed] = struct{}{}
	}

	if len(allowed) > 0 {
		if defaultAgent == "" {
			return fmt.Errorf("%s.defaultAgent: required when %s.allowedAgents is configured", prefix, prefix)
		}
		if _, ok := allowed[defaultAgent]; !ok {
			return fmt.Errorf("%s.defaultAgent: must be in %s.allowedAgents", prefix, prefix)
		}
	}
	return nil
}

func validateAgentName(name string) error {
	if !agentNamePattern.MatchString(name) {
		return fmt.Errorf("invalid agent name %q", name)
	}
	return nil
}
