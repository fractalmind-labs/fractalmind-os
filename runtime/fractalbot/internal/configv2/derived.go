package configv2

import (
	"path/filepath"
	"strings"
)

// ChannelInstance is one configured channel with its shared-channel settings.
type ChannelInstance struct {
	Type    string
	Name    string
	Ref     string // type.name
	Sharing Sharing
	// Secrets are the secret names this channel needs.
	Secrets []string
}

// ChannelList returns every configured channel instance in a stable order.
func (c *Config) ChannelList() []ChannelInstance {
	var out []ChannelInstance
	add := func(kind, name string, sharing Sharing, refs ...SecretRef) {
		inst := ChannelInstance{Type: kind, Name: name, Ref: kind + "." + name, Sharing: sharing}
		for _, r := range refs {
			if r != "" {
				inst.Secrets = append(inst.Secrets, r.Name())
			}
		}
		out = append(out, inst)
	}
	for _, n := range sortedKeys(c.Channels.Feishu) {
		v := c.Channels.Feishu[n]
		add(ChannelFeishu, n, v.Sharing, v.AppSecret)
	}
	for _, n := range sortedKeys(c.Channels.Telegram) {
		v := c.Channels.Telegram[n]
		refs := []SecretRef{v.BotToken}
		if v.Webhook != nil {
			refs = append(refs, v.Webhook.SecretToken)
		}
		add(ChannelTelegram, n, v.Sharing, refs...)
	}
	for _, n := range sortedKeys(c.Channels.IMessage) {
		add(ChannelIMessage, n, c.Channels.IMessage[n].Sharing)
	}
	for _, n := range sortedKeys(c.Channels.Slack) {
		v := c.Channels.Slack[n]
		add(ChannelSlack, n, v.Sharing, v.BotToken, v.AppToken)
	}
	for _, n := range sortedKeys(c.Channels.Discord) {
		v := c.Channels.Discord[n]
		add(ChannelDiscord, n, v.Sharing, v.Token)
	}
	for _, n := range sortedKeys(c.Channels.Demail) {
		v := c.Channels.Demail[n]
		add(ChannelDemail, n, v.Sharing, v.IdentityKey)
	}
	return out
}

// AgentsFor returns the agents bound to a channel instance, sorted.
func (c *Config) AgentsFor(ref string) []string {
	var out []string
	for _, name := range sortedKeys(c.Agents) {
		for _, r := range c.Agents[name].Channels {
			if r == ref {
				out = append(out, name)
				break
			}
		}
	}
	return out
}

// SecretNames returns every secret the configuration references.
func (c *Config) SecretNames() []string {
	seen := map[string]bool{}
	var out []string
	for _, inst := range c.ChannelList() {
		for _, s := range inst.Secrets {
			if !seen[s] {
				seen[s] = true
				out = append(out, s)
			}
		}
	}
	return out
}

// Paths are the runtime data locations derived from dataDir.
type Paths struct{ root string }

// Paths returns this configuration's derived data locations.
func (c *Config) Paths() Paths { return Paths{root: c.DataDir} }

// Root is dataDir.
func (p Paths) Root() string { return p.root }

// Inbox is an agent's durable inbox; done/, failed/ and the relay lock live
// inside it.
func (p Paths) Inbox(agent string) string { return filepath.Join(p.root, "inbox", agent) }

// ChannelState holds a channel instance's deduplication record, polling
// offset or cursor.
func (p Paths) ChannelState(kind, name string) string {
	return filepath.Join(p.root, "state", "channels", kind+"-"+name+".json")
}

// Selections holds each conversation's /use choice on shared channels.
func (p Paths) Selections() string { return filepath.Join(p.root, "state", "selections.json") }

// Schedules holds schedule state and reported outcomes.
func (p Paths) Schedules() string { return filepath.Join(p.root, "state", "schedules.json") }

// Secrets is the file store's directory.
func (p Paths) Secrets() string { return filepath.Join(p.root, "secrets") }

// AgentManagerScript is the agent-manager entrypoint for an agent.
func (c *Config) AgentManagerScript(agent Agent) string {
	script := c.Runtimes.AgentManager.Script
	if filepath.IsAbs(script) {
		return script
	}
	return filepath.Join(agent.Workspace, filepath.FromSlash(script))
}

// PromptFilePath is a job's prompt file inside its agent's workspace.
func (c *Config) PromptFilePath(j Job) string {
	return filepath.Join(c.Agents[j.Agent].Workspace, filepath.FromSlash(strings.ReplaceAll(j.PromptFile, `\`, "/")))
}
