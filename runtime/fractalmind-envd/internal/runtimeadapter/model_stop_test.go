package runtimeadapter

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/modelclient"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/nodecommand"
)

type synchronizedDirectAuthority struct {
	mu sync.Mutex
	*directNativeAuthority
}

func (p *synchronizedDirectAuthority) Resolve(ctx context.Context, c nodecommand.CapabilityRef) (nodecommand.CapabilityState, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.directNativeAuthority.Resolve(ctx, c)
}
func (p *synchronizedDirectAuthority) LookupExecution(ctx context.Context, cap, intent string) (nodecommand.ChainExecution, bool, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.directNativeAuthority.LookupExecution(ctx, cap, intent)
}
func (p *synchronizedDirectAuthority) ChainTime(ctx context.Context) (int64, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.directNativeAuthority.ChainTime(ctx)
}
func (p *synchronizedDirectAuthority) ValidateDirectCommand(ctx context.Context, c nodecommand.NodeCommand, s nodecommand.CapabilityState) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.directNativeAuthority.ValidateDirectCommand(ctx, c, s)
}

func TestNativeQuestionStopCancelsThePendingHTTPProvider(t *testing.T) {
	a, base, observer, request, command, _ := directNativeFixture(t, "ask", "", 0)
	p := &synchronizedDirectAuthority{directNativeAuthority: base}
	a.reader = p
	entered, closed := make(chan struct{}), make(chan struct{})
	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		// Consume the request as a real provider does, so net/http can observe
		// the client disconnect while the response remains pending.
		if _, err := io.Copy(io.Discard, r.Body); err != nil {
			return
		}
		_ = r.Body.Close()
		close(entered)
		<-r.Context().Done()
		close(closed)
	}))
	t.Cleanup(srv.Close)
	t.Cleanup(srv.CloseClientConnections)
	var err error
	a.model, err = modelclient.New(modelclient.Config{APIBase: srv.URL, Model: "synthetic-held-provider"})
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	checkpoint := base.run
	done := make(chan Response, 1)
	go func() {
		response, err := a.runAuthorized(ctx, request, command, &checkpoint)
		if err != nil {
			t.Error(err)
		}
		done <- response
	}()
	select {
	case <-entered:
	case <-ctx.Done():
		t.Fatal("original provider request was not reached")
	}
	p.mu.Lock()
	p.run.StopRequested = true
	p.mu.Unlock()
	select {
	case response := <-done:
		if response.OK || response.Error == nil || response.Error.Code != "cancelled" || len(response.Result) != 0 || response.Spend != nil || observer.callCount() != 0 || calls.Load() != 1 {
			t.Fatal("unsafe original question stop", response, calls.Load())
		}
	case <-time.After(3 * time.Second):
		t.Fatal("question ignored original stop while waiting")
	}
	select {
	case <-closed:
	case <-time.After(time.Second):
		t.Fatal("provider connection was not cancelled")
	}
}
