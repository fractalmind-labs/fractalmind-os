package channels

import (
	"context"
	"errors"
	"fmt"
	"log"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalbot/internal/configv2"
)

// Manager starts and stops configured channels.
type Manager struct {
	cfg     *configv2.Config
	secrets map[string]string
	handler IncomingMessageHandler
	// unavailable records channel instances that cannot start, such as one
	// whose secret is missing, with the reason. Other channels still start.
	unavailable map[string]string

	channels map[string]Channel
	workers  map[string]*channelWorker
	// feishuByReceiver selects the connected Feishu application that owns an
	// outbound reply. It is keyed by Feishu App ID, which is the normalized
	// inbound receiver_id; a chat ID alone is not sufficient because the same
	// chat can contain multiple bots.
	feishuByReceiver map[string]string

	startMu      sync.Mutex
	startCancels map[string]context.CancelFunc
}

// NewManager creates a channel manager for a configuration's channel
// instances. secrets holds the resolved values by secret name; an instance
// whose secret is absent is reported as unavailable instead of started.
func NewManager(cfg *configv2.Config, secrets map[string]string) *Manager {
	return &Manager{
		cfg:              cfg,
		secrets:          secrets,
		unavailable:      make(map[string]string),
		channels:         make(map[string]Channel),
		workers:          make(map[string]*channelWorker),
		feishuByReceiver: make(map[string]string),

		startCancels: make(map[string]context.CancelFunc),
	}
}

// SetHandler sets the inbound message handler used by channels.
func (m *Manager) SetHandler(handler IncomingMessageHandler) {
	m.handler = handler
	for _, channel := range m.channels {
		if handlerAware, ok := channel.(HandlerAware); ok {
			handlerAware.SetHandler(handler)
		}
	}
}

// Register adds a channel to the manager.
func (m *Manager) Register(channel Channel) error {
	if channel == nil {
		return errors.New("channel is nil")
	}
	name := channel.Name()
	if name == "" {
		return errors.New("channel name is required")
	}
	if _, exists := m.channels[name]; exists {
		return fmt.Errorf("channel %q already registered", name)
	}
	// Bind a concrete Feishu bot's platform receiver identity as part of the
	// successful registration path. That keeps the outbound identity index in
	// sync with the channel registry, including manually registered bots, and
	// avoids leaving a receiver mapping behind if registration is rejected.
	if bot, ok := channel.(*FeishuBot); ok {
		if err := m.registerFeishuReceiver(bot.appID, name); err != nil {
			return err
		}
	}
	if m.handler != nil {
		if handlerAware, ok := channel.(HandlerAware); ok {
			handlerAware.SetHandler(m.handler)
		}
	}
	m.channels[name] = channel
	return nil
}

// Get returns a channel by name.
func (m *Manager) Get(name string) Channel {
	return m.channels[name]
}

// List returns registered channels in name order.
func (m *Manager) List() []Channel {
	names := make([]string, 0, len(m.channels))
	for name := range m.channels {
		names = append(names, name)
	}
	sort.Strings(names)
	channels := make([]Channel, 0, len(names))
	for _, name := range names {
		channels = append(channels, m.channels[name])
	}
	return channels
}

// Start starts configured channels.
// Each channel gets an independent context (not derived from the parent) so
// that a crash or context cancellation in one channel cannot cascade to others.
// The parent ctx is only used to trigger graceful shutdown of all channels.
func (m *Manager) Start(ctx context.Context) error {
	if err := m.registerConfiguredChannels(); err != nil {
		return err
	}

	for _, channel := range m.List() {
		if channel.IsRunning() {
			continue
		}
		name := channel.Name()
		if m.hasInFlightStart(name) {
			continue
		}
		// Independent context per channel — isolates crash/cancel from other channels.
		channelCtx, cancel := context.WithCancel(context.Background())
		m.trackInFlightStart(name, cancel)

		// Create and start per-channel worker
		w := newChannelWorker(channel)
		m.workers[name] = w
		w.start(channelCtx)

		go m.startChannel(name, channel, channelCtx)
	}

	return nil
}

// Stop stops configured channels and their workers.
func (m *Manager) Stop() error {
	m.cancelInFlightStarts()

	// Stop workers first so no new sends are attempted
	for name, w := range m.workers {
		w.stop()
		delete(m.workers, name)
	}

	var errs []error
	for _, channel := range m.List() {
		if !channel.IsRunning() {
			continue
		}
		if err := channel.Stop(context.Background()); err != nil {
			errs = append(errs, fmt.Errorf("%s: %w", channel.Name(), err))
		}
	}

	if len(errs) > 0 {
		return fmt.Errorf("failed to stop channels: %v", errs)
	}

	return nil
}

// Send routes an outbound message through the channel's worker.
// It performs a synchronous send with rate limiting and returns result metadata.
// Returns error if the channel is not found.
func (m *Manager) Send(ctx context.Context, channelName string, msg OutboundMessage) (*SendResult, error) {
	requestedChannel := strings.TrimSpace(channelName)
	if strings.EqualFold(requestedChannel, "feishu") {
		resolvedChannel, err := m.resolveFeishuOutboundChannel(msg.ReceiverID)
		if err != nil {
			return nil, err
		}
		channelName = resolvedChannel
	} else if strings.HasPrefix(strings.ToLower(requestedChannel), "feishu/") {
		// Named Feishu channels are an implementation detail. Require and verify
		// the App ID even when one is named explicitly so an API/CLI caller cannot
		// accidentally send a reply through a bot other than the one that received
		// the inbound event.
		if strings.TrimSpace(msg.ReceiverID) == "" {
			return nil, errors.New("feishu receiver_id is required for a named Feishu bot")
		}
		resolvedChannel, err := m.resolveFeishuOutboundChannel(msg.ReceiverID)
		if err != nil {
			return nil, err
		}
		if !strings.EqualFold(requestedChannel, resolvedChannel) {
			return nil, errors.New("feishu receiver_id does not match the requested bot")
		}
		// Use the registered spelling from the receiver map. This also allows the
		// CLI's normalized channel argument to address a config instance name
		// containing uppercase characters.
		channelName = resolvedChannel
	}
	w, ok := m.workers[channelName]
	if !ok {
		// Fallback to direct send if worker not started yet
		ch := m.Get(channelName)
		if ch == nil {
			return nil, fmt.Errorf("channel %q not found", channelName)
		}
		return ch.Send(ctx, msg)
	}
	return w.sendSync(ctx, msg)
}

func (m *Manager) resolveFeishuOutboundChannel(receiverID string) (string, error) {
	receiverID = strings.TrimSpace(receiverID)
	if receiverID != "" {
		if channelName, ok := m.feishuByReceiver[receiverID]; ok {
			return channelName, nil
		}
		return "", errors.New("feishu receiver_id does not match a configured bot")
	}

	// The old singleton configuration continues to own unspecified Feishu
	// outbound sends only when it is the sole configured identity. As soon as
	// any named bot is also configured, an unspecified send is ambiguous and
	// must not silently fall back to the legacy bot.
	if m.Get("feishu") != nil && len(m.feishuByReceiver) == 1 {
		return "feishu", nil
	}
	if len(m.feishuByReceiver) > 0 {
		return "", errors.New("feishu receiver_id is required when multiple or named Feishu bots are configured")
	}
	return "feishu", nil
}

func (m *Manager) startChannel(name string, channel Channel, ctx context.Context) {
	defer m.clearInFlightStart(name)
	defer func() {
		if r := recover(); r != nil {
			log.Printf("channel %s panicked: %v", name, r)
		}
	}()
	if err := channel.Start(ctx); err != nil {
		log.Printf("channel %s failed to start: %v", name, err)
	}
}

func (m *Manager) hasInFlightStart(name string) bool {
	m.startMu.Lock()
	defer m.startMu.Unlock()
	_, ok := m.startCancels[name]
	return ok
}

func (m *Manager) trackInFlightStart(name string, cancel context.CancelFunc) {
	m.startMu.Lock()
	m.startCancels[name] = cancel
	m.startMu.Unlock()
}

func (m *Manager) clearInFlightStart(name string) {
	m.startMu.Lock()
	delete(m.startCancels, name)
	m.startMu.Unlock()
}

func (m *Manager) cancelInFlightStarts() {
	m.startMu.Lock()
	cancels := make([]context.CancelFunc, 0, len(m.startCancels))
	for name, cancel := range m.startCancels {
		cancels = append(cancels, cancel)
		delete(m.startCancels, name)
	}
	m.startMu.Unlock()
	for _, cancel := range cancels {
		cancel()
	}
}

func (m *Manager) registerConfiguredChannels() error {
	if m.cfg == nil {
		return nil
	}
	for _, inst := range m.cfg.ChannelList() {
		if m.Get(channelNameFor(inst)) != nil {
			continue
		}
		missing := ""
		for _, name := range inst.Secrets {
			if m.secrets[name] == "" {
				missing = name
				break
			}
		}
		if missing != "" {
			m.unavailable[inst.Ref] = "secret " + missing + " is not set"
			log.Printf("channel %s not started: secret %s is not set", inst.Ref, missing)
			continue
		}
		channel, err := m.buildChannel(inst)
		if err != nil {
			m.unavailable[inst.Ref] = err.Error()
			log.Printf("channel %s not started: %v", inst.Ref, err)
			continue
		}
		if err := m.Register(channel); err != nil {
			return fmt.Errorf("register %s: %w", inst.Ref, err)
		}
	}
	return nil
}

// Unavailable returns configured channel instances that could not start, with
// the reason.
func (m *Manager) Unavailable() map[string]string {
	out := make(map[string]string, len(m.unavailable))
	for k, v := range m.unavailable {
		out[k] = v
	}
	return out
}

// channelNameFor is the registry name of an instance. Feishu supports several
// applications; other types have one instance named by the type.
func channelNameFor(inst configv2.ChannelInstance) string {
	if inst.Type == configv2.ChannelFeishu {
		return feishuInstanceChannelName(inst.Name)
	}
	return inst.Type
}

// agentSelection is what a channel's /agent and /to accept: the agents bound
// to the instance, with its default (or its only agent) when none is named.
func (m *Manager) agentSelection(inst configv2.ChannelInstance) (string, []string) {
	agents := m.cfg.AgentsFor(inst.Ref)
	def := inst.Sharing.Default
	if def == "" && len(agents) == 1 {
		def = agents[0]
	}
	return def, agents
}

func (m *Manager) buildChannel(inst configv2.ChannelInstance) (Channel, error) {
	def, agents := m.agentSelection(inst)
	paths := m.cfg.Paths()
	state := paths.ChannelState(inst.Type, inst.Name)
	secret := func(r configv2.SecretRef) string { return m.secrets[r.Name()] }
	switch inst.Type {
	case configv2.ChannelFeishu:
		c := m.cfg.Channels.Feishu[inst.Name]
		bot, err := NewNamedFeishuBot(inst.Name, c.AppID, secret(c.AppSecret), c.Domain, c.AllowedUsers, def, agents)
		if err != nil {
			return nil, err
		}
		bot.ConfigureDedupe(state)
		return bot, nil
	case configv2.ChannelTelegram:
		c := m.cfg.Channels.Telegram[inst.Name]
		bot, err := NewTelegramBot(secret(c.BotToken), c.AllowedUsers, c.AdminID, def, agents)
		if err != nil {
			return nil, err
		}
		bot.setAllowedChats(c.AllowedChats)
		bot.ConfigureMode(c.Mode)
		bot.ConfigurePolling(c.PollingTimeoutSeconds, c.PollingLimit, state)
		if w := c.Webhook; w != nil {
			bot.ConfigureWebhook(w.ListenAddr, w.Path, w.PublicURL, secret(w.SecretToken))
			bot.ConfigureWebhookLifecycle(w.RegisterOnStart, w.DeleteOnStop)
		}
		return bot, nil
	case configv2.ChannelSlack:
		c := m.cfg.Channels.Slack[inst.Name]
		return NewSlackBot(secret(c.BotToken), secret(c.AppToken), c.AllowedUsers, c.AllowedChannels, def, agents)
	case configv2.ChannelDiscord:
		c := m.cfg.Channels.Discord[inst.Name]
		return NewDiscordBot(secret(c.Token), c.AllowedUsers, def, agents)
	case configv2.ChannelIMessage:
		c := m.cfg.Channels.IMessage[inst.Name]
		bot, err := NewIMessageBot(c.Recipient, "", c.Service)
		if err != nil {
			return nil, err
		}
		bot.ConfigurePolling(true, c.PollIntervalSeconds, c.PollLimit, c.DatabasePath)
		return bot, nil
	case configv2.ChannelDemail:
		c := m.cfg.Channels.Demail[inst.Name]
		return NewDemailChannel(DemailOptions{
			GraphQLURL:     c.GraphQLURL,
			PackageID:      c.PackageID,
			Address:        c.Address,
			IdentityKey:    secret(c.IdentityKey),
			SponsorAddress: c.SponsorAddress,
			GasCoin:        c.GasCoin,
			PollInterval:   time.Duration(c.PollIntervalSeconds) * time.Second,
			CursorFile:     state,
			AllowedSenders: c.AllowedSenders,
			Peers:          c.Peers,
		})
	}
	return nil, fmt.Errorf("unsupported channel type %q", inst.Type)
}

func (m *Manager) registerFeishuReceiver(receiverID, channelName string) error {
	receiverID = strings.TrimSpace(receiverID)
	if existing, ok := m.feishuByReceiver[receiverID]; ok && existing != channelName {
		return errors.New("feishu app ID is configured by more than one bot")
	}
	m.feishuByReceiver[receiverID] = channelName
	return nil
}

func feishuInstanceChannelName(name string) string {
	return "feishu/" + strings.TrimSpace(name)
}
