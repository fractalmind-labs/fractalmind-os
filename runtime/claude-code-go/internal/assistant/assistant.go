package assistant

import (
	"fmt"
	"strings"
)

type Result struct {
	Status    string
	SessionID string
	Action    string
}

func Run(args []string) (Result, error) {
	if len(args) > 1 {
		return Result{}, fmt.Errorf("usage: claude-code-go assistant [sessionId]")
	}

	sessionID := ""
	if len(args) == 1 {
		sessionID = strings.TrimSpace(args[0])
		if sessionID == "" {
			return Result{}, fmt.Errorf("usage: claude-code-go assistant [sessionId]")
		}
	}

	result := Result{
		Status:    "stub",
		SessionID: sessionID,
		Action:    "discover-sessions",
	}
	if sessionID != "" {
		result.Action = "attach-session"
	}
	return result, nil
}

func (r Result) String() string {
	sessionID := r.SessionID
	if sessionID == "" {
		sessionID = "none"
	}
	return fmt.Sprintf("status=%s\nsession_id=%s\naction=%s\n", r.Status, sessionID, r.Action)
}
