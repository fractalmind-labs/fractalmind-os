package router

import (
	"context"
	"fmt"
	"strings"

	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalbot/pkg/localruntime"
)

// agentManagerLifecycle is what the agentManager runtime offers channel
// commands (/monitor, /startagent, /stopagent).
type agentManagerLifecycle interface {
	localruntime.Starter
	Monitor(ctx context.Context, target localruntime.Target, lines int) (string, error)
	Stop(ctx context.Context, target localruntime.Target) error
}

func (r *Router) lifecycle(agent string) (agentManagerLifecycle, localruntime.Target, error) {
	a, ok := r.cfg.Agents[agent]
	if !ok {
		return nil, localruntime.Target{}, fmt.Errorf("agent %q is not configured", agent)
	}
	lc, ok := r.adapters[a.Runtime].(agentManagerLifecycle)
	if !ok {
		return nil, localruntime.Target{}, fmt.Errorf("agent %q runs in %s, which has no start, stop or monitor", agent, a.Runtime)
	}
	return lc, r.Target(agent), nil
}

// MonitorAgent implements channels.AgentLifecycle.
func (r *Router) MonitorAgent(ctx context.Context, agent string, lines int) (string, error) {
	lc, target, err := r.lifecycle(agent)
	if err != nil {
		return "", err
	}
	return lc.Monitor(ctx, target, lines)
}

// StartAgent implements channels.AgentLifecycle.
func (r *Router) StartAgent(ctx context.Context, agent string) (string, error) {
	lc, target, err := r.lifecycle(agent)
	if err != nil {
		return "", err
	}
	if err := lc.Start(ctx, target); err != nil {
		return "", err
	}
	return agent + " started", nil
}

// StopAgent implements channels.AgentLifecycle.
func (r *Router) StopAgent(ctx context.Context, agent string) (string, error) {
	lc, target, err := r.lifecycle(agent)
	if err != nil {
		return "", err
	}
	if err := lc.Stop(ctx, target); err != nil {
		return "", err
	}
	return agent + " stopped", nil
}

// Doctor implements channels.AgentLifecycle: each agent's runtime, presence
// and last delivery.
func (r *Router) Doctor(ctx context.Context) (string, error) {
	var b strings.Builder
	for _, st := range r.Status(ctx) {
		fmt.Fprintf(&b, "%s: %s, %s", st.Name, st.Runtime, st.Presence)
		if d := st.LastDelivery; d != nil {
			fmt.Fprintf(&b, ", last %s from %s", d.Status, d.Source)
			if d.Error != "" {
				fmt.Fprintf(&b, " (%s)", d.Error)
			}
		}
		b.WriteString("\n")
	}
	return strings.TrimSpace(b.String()), nil
}
