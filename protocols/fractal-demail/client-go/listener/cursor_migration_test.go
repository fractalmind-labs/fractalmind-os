package listener

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/fractalmind-labs/fractalmind-os/protocols/fractal-demail/client-go/schema"
)

func TestEndpointAliasMigration(t *testing.T) {
	_, key, _ := ed25519.GenerateKey(rand.Reader)
	for _, network := range []string{"mainnet", "testnet"} {
		cfg := Config{RPCURL: "https://fullnode." + network + ".sui.io:443", PackageID: packageID, Recipient: recipientAddr, IdentityKey: key}
		l, err := New(cfg, func(string, *schema.Plaintext) {})
		if err != nil {
			t.Fatal(err)
		}
		if l.cfg.GraphQLURL != "https://graphql."+network+".sui.io/graphql" {
			t.Fatalf("alias used old endpoint: %s", l.cfg.GraphQLURL)
		}
		cfg.GraphQLURL = "https://custom.example/graphql"
		l, err = New(cfg, func(string, *schema.Plaintext) {})
		if err != nil || l.cfg.GraphQLURL != cfg.GraphQLURL {
			t.Fatal("explicit GraphQL URL did not win")
		}
	}
}

func TestLegacyCursorMigratesExactEventAndResumes(t *testing.T) {
	_, key, _ := ed25519.GenerateKey(rand.Reader)
	path := filepath.Join(t.TempDir(), "cursor.json")
	old := `{"txDigest":"original","eventSeq":"2"}`
	if err := os.WriteFile(path, []byte(old), 0600); err != nil {
		t.Fatal(err)
	}
	migrations := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Operation string         `json:"operationName"`
			Variables map[string]any `json:"variables"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Error(err)
		}
		var data any
		switch req.Operation {
		case "EventCheckpoint":
			if req.Variables["digest"] != "original" {
				t.Error("wrong transaction")
			}
			data = map[string]any{"transaction": map[string]any{"effects": map[string]any{"checkpoint": map[string]any{"sequenceNumber": 42}}}}
		case "MigrateEventCursor":
			migrations++
			if req.Variables["checkpoint"] != float64(42) {
				t.Error("wrong checkpoint")
			}
			if migrations == 1 {
				data = map[string]any{"events": map[string]any{"edges": []any{}, "pageInfo": map[string]any{"hasNextPage": true, "endCursor": "checkpoint-page"}}}
			} else {
				if req.Variables["after"] != "checkpoint-page" {
					t.Error("checkpoint pagination skipped")
				}
				data = map[string]any{"events": map[string]any{"edges": []any{map[string]any{"cursor": "opaque-exact-event", "node": map[string]any{"transaction": map[string]any{"digest": "original"}, "sequenceNumber": 2}}}, "pageInfo": map[string]any{"hasNextPage": false}}}
			}
		case "MessageEvents":
			if req.Variables["after"] != "opaque-exact-event" || req.Variables["last"] != nil {
				t.Error("listener reset to tip instead of resuming")
			}
			data = map[string]any{"events": map[string]any{"edges": []any{}, "pageInfo": map[string]any{"hasNextPage": false}}}
		default:
			t.Errorf("unexpected operation %s", req.Operation)
		}
		json.NewEncoder(w).Encode(map[string]any{"data": data})
	}))
	defer srv.Close()
	l, err := New(Config{GraphQLURL: srv.URL, PackageID: packageID, Recipient: recipientAddr, IdentityKey: key, CursorFile: path}, func(string, *schema.Plaintext) { t.Error("replayed old event") })
	if err != nil {
		t.Fatal(err)
	}
	if err = l.PollOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	saved, err := os.ReadFile(path)
	if err != nil || string(saved) != `"opaque-exact-event"` || migrations != 2 {
		t.Fatalf("cursor %s err %v pages %d", saved, err, migrations)
	}
}

func TestLegacyCursorFailurePreservesCheckpoint(t *testing.T) {
	for _, response := range []string{`{"data":{"transaction":null}}`, `{"data":{"transaction":null},"errors":[{"message":"indexer unavailable"}]}`} {
		t.Run(response, func(t *testing.T) {
			_, key, _ := ed25519.GenerateKey(rand.Reader)
			path := filepath.Join(t.TempDir(), "cursor")
			old := `{"txDigest":"original","eventSeq":"2"}`
			os.WriteFile(path, []byte(old), 0600)
			calls := 0
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls++; w.Write([]byte(response)) }))
			defer srv.Close()
			l, err := New(Config{GraphQLURL: srv.URL, PackageID: packageID, Recipient: recipientAddr, IdentityKey: key, CursorFile: path}, func(string, *schema.Plaintext) { t.Error("unexpected delivery") })
			if err != nil {
				t.Fatal(err)
			}
			for i := 0; i < 2; i++ {
				if err := l.PollOnce(context.Background()); err == nil {
					t.Fatal("missing history accepted")
				}
			}
			saved, _ := os.ReadFile(path)
			if string(saved) != old || l.cursor != nil || calls != 2 {
				t.Fatalf("checkpoint lost: %s", saved)
			}
		})
	}
}

func TestGraphQLPartialErrorsDoNotAdvanceCursor(t *testing.T) {
	_, key, _ := ed25519.GenerateKey(rand.Reader)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"data":{"events":{"edges":[],"pageInfo":{"endCursor":"new","hasNextPage":false}}},"errors":[{"message":"partial failure"}]}`))
	}))
	defer srv.Close()
	l, err := New(Config{GraphQLURL: srv.URL, PackageID: packageID, Recipient: recipientAddr, IdentityKey: key}, func(string, *schema.Plaintext) {})
	if err != nil {
		t.Fatal(err)
	}
	l.cursor = json.RawMessage(`"old"`)
	if err := l.PollOnce(context.Background()); err == nil || string(l.cursor) != `"old"` {
		t.Fatal("partial GraphQL result advanced cursor")
	}
}
