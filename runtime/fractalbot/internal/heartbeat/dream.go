package heartbeat

import (
	"fmt"
	"strings"
	"time"

	"github.com/fractalmind-ai/fractalbot/internal/config"
)

const (
	dispatchKindHeartbeat   = "heartbeat"
	dispatchKindDream       = "dream"
	dreamWindowIdleAfter    = "idle_after"
	defaultDreamInstruction = "Read DREAM.md if it exists (workspace context). Follow it strictly. Do not infer or repeat old tasks from prior chats. If nothing worth doing emerges, reply DREAM_OK."
)

type dreamDecision struct {
	Kind     string
	Text     string
	WindowID string
	Timeout  time.Duration
}

func decideDream(job config.HeartbeatJobConfig, now time.Time, lastInbound, lastDispatch time.Time, inFlight bool) dreamDecision {
	heartbeat := dreamDecision{Kind: dispatchKindHeartbeat, Text: job.Text}
	dream := job.Dream
	if dream == nil || !dream.Enabled {
		return heartbeat
	}
	text := strings.TrimSpace(dream.Text)
	if text == "" {
		text = defaultDreamInstruction
	}
	timeout := parsePositiveDuration(dream.MaxRuntime)
	if windowID, ok := firstMatchingDreamWindow(job, now); ok {
		return dreamDecision{Kind: dispatchKindDream, Text: text, WindowID: windowID, Timeout: timeout}
	}
	if inFlight {
		return heartbeat
	}
	idleAfter := parsePositiveDuration(dream.IdleAfter)
	if idleAfter <= 0 {
		return heartbeat
	}
	idleStart := lastInbound
	if idleStart.IsZero() {
		idleStart = lastDispatch
	}
	if idleStart.IsZero() || now.Before(idleStart.Add(idleAfter)) {
		return heartbeat
	}
	return dreamDecision{Kind: dispatchKindDream, Text: text, WindowID: dreamWindowIdleAfter, Timeout: timeout}
}

func firstMatchingDreamWindow(job config.HeartbeatJobConfig, now time.Time) (string, bool) {
	if job.Dream == nil {
		return "", false
	}
	for _, window := range job.Dream.FixedWindows {
		timezone := strings.TrimSpace(window.Timezone)
		if timezone == "" {
			timezone = strings.TrimSpace(job.Timezone)
		}
		location, err := time.LoadLocation(timezone)
		if err != nil {
			continue
		}
		startHour, startMinute, startSecond, err := config.ParseClock(window.Start)
		if err != nil {
			continue
		}
		endHour, endMinute, endSecond, err := config.ParseClock(window.End)
		if err != nil {
			continue
		}
		if !clockInWindow(now.In(location), startHour, startMinute, startSecond, endHour, endMinute, endSecond) {
			continue
		}
		return fmt.Sprintf("%s-%s", strings.TrimSpace(window.Start), strings.TrimSpace(window.End)), true
	}
	return "", false
}

func clockInWindow(now time.Time, startHour, startMinute, startSecond, endHour, endMinute, endSecond int) bool {
	current := now.Hour()*3600 + now.Minute()*60 + now.Second()
	start := startHour*3600 + startMinute*60 + startSecond
	end := endHour*3600 + endMinute*60 + endSecond
	if start == end {
		return false
	}
	if start < end {
		return current >= start && current < end
	}
	return current >= start || current < end
}

func parsePositiveDuration(value string) time.Duration {
	duration, err := time.ParseDuration(strings.TrimSpace(value))
	if err != nil || duration <= 0 {
		return 0
	}
	return duration
}
