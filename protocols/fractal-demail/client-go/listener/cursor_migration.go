package listener

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
)

// Resolve a stored JSON-RPC event ID to an opaque GraphQL cursor by finding the
// exact event in its original checkpoint. Do not reset to the current tip: that
// would silently drop messages sent while the listener was offline.
func (l *Listener) migrateLegacyCursor(ctx context.Context) error {
	var legacy struct {
		TxDigest string `json:"txDigest"`
		EventSeq string `json:"eventSeq"`
	}
	if err := json.Unmarshal(l.legacyCursor, &legacy); err != nil {
		return err
	}
	seq, err := strconv.ParseUint(legacy.EventSeq, 10, 53)
	if err != nil {
		return fmt.Errorf("invalid legacy event sequence: %w", err)
	}
	var checkpoint struct {
		Transaction *struct {
			Effects *struct {
				Checkpoint *struct {
					SequenceNumber uint64 `json:"sequenceNumber"`
				} `json:"checkpoint"`
			} `json:"effects"`
		} `json:"transaction"`
	}
	if err := l.query(ctx, "EventCheckpoint", `query EventCheckpoint($digest: String!) {
	  transaction(digest: $digest) { effects { checkpoint { sequenceNumber } } }
	}`, map[string]any{"digest": legacy.TxDigest}, &checkpoint); err != nil {
		return err
	}
	if checkpoint.Transaction == nil || checkpoint.Transaction.Effects == nil || checkpoint.Transaction.Effects.Checkpoint == nil {
		return fmt.Errorf("legacy checkpoint is unavailable; use a GraphQL provider with retained history (the cursor file has been preserved)")
	}
	variables := map[string]any{"checkpoint": checkpoint.Transaction.Effects.Checkpoint.SequenceNumber, "type": l.cfg.PackageID + "::demail::MessageSent"}
	for {
		var data struct {
			Events struct {
				Edges []struct {
					Cursor string `json:"cursor"`
					Node   struct {
						Transaction *struct {
							Digest string `json:"digest"`
						} `json:"transaction"`
						SequenceNumber uint64 `json:"sequenceNumber"`
					} `json:"node"`
				} `json:"edges"`
				PageInfo struct {
					EndCursor   *string `json:"endCursor"`
					HasNextPage bool    `json:"hasNextPage"`
				} `json:"pageInfo"`
			} `json:"events"`
		}
		if err := l.query(ctx, "MigrateEventCursor", `query MigrateEventCursor($type: String!, $checkpoint: UInt53!, $after: String) {
		  events(first: 50, after: $after, filter: {type: $type, atCheckpoint: $checkpoint}) {
		    edges { cursor node { transaction { digest } sequenceNumber } }
		    pageInfo { endCursor hasNextPage }
		  }
		}`, variables, &data); err != nil {
			return err
		}
		for _, edge := range data.Events.Edges {
			if edge.Node.Transaction != nil && edge.Node.Transaction.Digest == legacy.TxDigest && edge.Node.SequenceNumber == seq {
				if edge.Cursor == "" {
					return fmt.Errorf("migration returned an empty cursor")
				}
				cursor, _ := json.Marshal(edge.Cursor)
				l.setCursor(cursor)
				l.legacyCursor = nil
				return nil
			}
		}
		page := data.Events.PageInfo
		if !page.HasNextPage {
			return fmt.Errorf("original event not found in its checkpoint; cursor file has been preserved")
		}
		if page.EndCursor == nil || *page.EndCursor == "" || variables["after"] == *page.EndCursor {
			return fmt.Errorf("event migration pagination did not advance")
		}
		variables["after"] = *page.EndCursor
	}
}
