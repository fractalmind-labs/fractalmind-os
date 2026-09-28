package sui

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"github.com/block-vision/sui-go-sdk/models"
)

// The legacy EventId struct is retained at the domain boundary, with an
// explicit marker so a JSON-RPC cursor can never be mistaken for a GraphQL one.
const graphqlCursorMarker = "graphql"

func (c *GRPCClient) SuiXQueryEvents(ctx context.Context, req models.SuiXQueryEventsRequest) (models.PaginatedEventsResponse, error) {
	if c.graphqlURL == "" {
		return models.PaginatedEventsResponse{}, fmt.Errorf("sui.graphql_url is required for indexed event queries")
	}
	filter, err := json.Marshal(req.SuiEventFilter)
	if err != nil {
		return models.PaginatedEventsResponse{}, err
	}
	var eventFilter struct {
		Type string `json:"MoveEventType"`
	}
	if err := json.Unmarshal(filter, &eventFilter); err != nil || eventFilter.Type == "" {
		return models.PaginatedEventsResponse{}, fmt.Errorf("a Move event type filter is required")
	}
	variables := map[string]any{"type": eventFilter.Type, "first": req.Limit}
	if req.DescendingOrder {
		delete(variables, "first")
		variables["last"] = req.Limit
	}
	if req.Cursor != nil {
		data, err := json.Marshal(req.Cursor)
		if err != nil {
			return models.PaginatedEventsResponse{}, err
		}
		var cursor models.EventId
		if err := json.Unmarshal(data, &cursor); err != nil || cursor.TxDigest != graphqlCursorMarker || cursor.EventSeq == "" {
			return models.PaginatedEventsResponse{}, fmt.Errorf("cannot reuse a JSON-RPC event ID as a GraphQL cursor")
		}
		if req.DescendingOrder {
			variables["before"] = cursor.EventSeq
		} else {
			variables["after"] = cursor.EventSeq
		}
	}
	query := `query PeerEvents($type: String!, $first: Int, $last: Int, $after: String, $before: String) {
	  events(first: $first, last: $last, after: $after, before: $before, filter: {type: $type}) {
	    nodes { contents { json } }
	    pageInfo { endCursor hasNextPage startCursor hasPreviousPage }
	  }
	}`
	body, err := json.Marshal(map[string]any{"query": query, "variables": variables})
	if err != nil {
		return models.PaginatedEventsResponse{}, err
	}
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, c.graphqlURL, bytes.NewReader(body))
	if err != nil {
		return models.PaginatedEventsResponse{}, err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	resp, err := c.http.Do(httpReq)
	if err != nil {
		return models.PaginatedEventsResponse{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return models.PaginatedEventsResponse{}, fmt.Errorf("GraphQL HTTP %d", resp.StatusCode)
	}
	var result struct {
		Errors []struct {
			Message string `json:"message"`
		} `json:"errors"`
		Data *struct {
			Events struct {
				Nodes []struct {
					Contents struct {
						JSON map[string]any `json:"json"`
					} `json:"contents"`
				} `json:"nodes"`
				PageInfo struct {
					EndCursor       *string `json:"endCursor"`
					HasNextPage     bool    `json:"hasNextPage"`
					StartCursor     *string `json:"startCursor"`
					HasPreviousPage bool    `json:"hasPreviousPage"`
				} `json:"pageInfo"`
			} `json:"events"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return models.PaginatedEventsResponse{}, err
	}
	if len(result.Errors) > 0 {
		messages := []string{}
		for _, err := range result.Errors {
			messages = append(messages, err.Message)
		}
		return models.PaginatedEventsResponse{}, fmt.Errorf("GraphQL: %s", strings.Join(messages, "; "))
	}
	if result.Data == nil {
		return models.PaginatedEventsResponse{}, fmt.Errorf("missing GraphQL data")
	}
	page := result.Data.Events.PageInfo
	next := page.EndCursor
	hasNext := page.HasNextPage
	if req.DescendingOrder {
		next = page.StartCursor
		hasNext = page.HasPreviousPage
	}
	out := models.PaginatedEventsResponse{HasNextPage: hasNext}
	if hasNext && (next == nil || *next == "") {
		return models.PaginatedEventsResponse{}, fmt.Errorf("GraphQL pagination returned no cursor")
	}
	if next != nil {
		out.NextCursor = models.EventId{TxDigest: graphqlCursorMarker, EventSeq: *next}
	}
	for _, evt := range result.Data.Events.Nodes {
		out.Data = append(out.Data, models.SuiEventResponse{ParsedJson: evt.Contents.JSON, Type: eventFilter.Type})
	}
	return out, nil
}
