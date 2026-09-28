package sui

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/block-vision/sui-go-sdk/models"
)

func TestGraphQLEventPaginationAndErrors(t *testing.T) {
	var fail atomic.Bool
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Variables map[string]any `json:"variables"`
		}
		json.NewDecoder(r.Body).Decode(&req)
		if req.Variables["after"] != "opaque" || req.Variables["type"] != "0x3::peer::PeerRegistered" {
			t.Error("wrong event pagination/filter")
		}
		if fail.Load() {
			w.Write([]byte(`{"data":{},"errors":[{"message":"indexer lag"}]}`))
			return
		}
		w.Write([]byte(`{"data":{"events":{"nodes":[{"contents":{"json":{"relay_capacity":"18446744073709551615"}}}],"pageInfo":{"endCursor":"next","hasNextPage":true}}}}`))
	}))
	defer srv.Close()
	c, err := NewGRPCClient("http://localhost:9000", srv.URL)
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	req := models.SuiXQueryEventsRequest{SuiEventFilter: models.EventFilterByMoveEventType{MoveEventType: "0x3::peer::PeerRegistered"}, Cursor: models.EventId{TxDigest: graphqlCursorMarker, EventSeq: "opaque"}, Limit: 50}
	result, err := c.SuiXQueryEvents(context.Background(), req)
	if err != nil || !result.HasNextPage || result.NextCursor.EventSeq != "next" {
		t.Fatalf("events: %+v %v", result, err)
	}
	fail.Store(true)
	if _, err := c.SuiXQueryEvents(context.Background(), req); err == nil {
		t.Fatal("partial error accepted")
	}
	req.Cursor = models.EventId{TxDigest: "legacy", EventSeq: "0"}
	if _, err := c.SuiXQueryEvents(context.Background(), req); err == nil {
		t.Fatal("legacy event ID accepted as GraphQL cursor")
	}
}

func TestPollUsesSeparateCursorsAndDrainsPages(t *testing.T) {
	calls := map[string]int{}
	rpc := &mockRPC{queryEventsFn: func(_ context.Context, req models.SuiXQueryEventsRequest) (models.PaginatedEventsResponse, error) {
		eventType := req.SuiEventFilter.(models.EventFilterByMoveEventType).MoveEventType
		calls[eventType]++
		count := calls[eventType]
		if count == 1 && req.Cursor != nil {
			t.Error("first cursor crossed event types")
		}
		if count > 1 {
			cursor, ok := req.Cursor.(models.EventId)
			if !ok || !strings.HasPrefix(cursor.EventSeq, eventType) {
				t.Error("cursor belongs to a different event type")
			}
		}
		return models.PaginatedEventsResponse{NextCursor: models.EventId{TxDigest: graphqlCursorMarker, EventSeq: eventType + string(rune('0'+count))}, HasNextPage: count == 1}, nil
	}}
	c := newClientWithRPC(rpc, testKeypair(t), "0x3", "", "", "org", "")
	_, cursor, err := c.PollNewEvents(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(cursor.(map[string]models.EventId)) != 5 {
		t.Fatal("not all event types checkpointed")
	}
	if _, _, err := c.PollNewEvents(context.Background(), cursor); err != nil {
		t.Fatal(err)
	}
	for eventType, count := range calls {
		if count != 3 {
			t.Errorf("%s: pages = %d", eventType, count)
		}
	}
}

func TestNativeGraphQLPeerFields(t *testing.T) {
	peers := map[string]*PeerInfo{}
	applyPeerRegistered(map[string]any{"peer": "0x1", "wireguard_pubkey": []any{float64(1), float64(255)}, "org_id": "org"}, peers)
	applyRelayRegistered(map[string]any{"peer": "0x1", "relay_capacity": "18446744073709551615"}, peers)
	if string(peers["0x1"].WireGuardPubKey) != string([]byte{1, 255}) || peers["0x1"].RelayCapacity != 18446744073709551615 {
		t.Fatalf("peer: %+v", peers["0x1"])
	}
}
