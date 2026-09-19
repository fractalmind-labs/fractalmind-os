package runtimeadapter

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"time"
)

const defaultOutputLimit = 64 << 10

type processAdapter struct {
	Command     string
	Args        []string
	Dir         string
	Env         []string
	OutputLimit int
}

type RunError struct {
	Code string
	Err  error
}

func (e *RunError) Error() string { return e.Err.Error() }
func (e *RunError) Unwrap() error { return e.Err }

func RunErrorCode(err error) string {
	var runErr *RunError
	if errors.As(err, &runErr) {
		return runErr.Code
	}
	return "internal_error"
}

func runError(code string, err error) error {
	return &RunError{Code: code, Err: err}
}

func AgentManager(command string, args ...string) Adapter {
	return &processAdapter{Command: command, Args: append(args, "adapter")}
}

func (a *processAdapter) run(ctx context.Context, request Request) (Response, error) {
	if err := request.Validate(); err != nil {
		return Response{}, err
	}

	if ctx == nil {
		ctx = context.Background()
	}
	cancel := func() {}
	if request.TimeoutSeconds > 0 {
		ctx, cancel = context.WithTimeout(ctx, time.Duration(request.TimeoutSeconds*float64(time.Second)))
	}
	defer cancel()
	if request.Cancel {
		return Response{}, runError("cancelled", fmt.Errorf("adapter cancelled before execution"))
	}

	payload, err := json.Marshal(request)
	if err != nil {
		return Response{}, fmt.Errorf("marshal adapter request: %w", err)
	}
	if a.Command == "" {
		return Response{}, fmt.Errorf("adapter command is required")
	}

	cmd := exec.CommandContext(ctx, a.Command, a.Args...)
	configureProcessGroup(cmd)
	cmd.Dir = a.Dir
	if len(a.Env) > 0 {
		cmd.Env = append(os.Environ(), a.Env...)
	}
	cmd.Stdin = bytes.NewReader(payload)
	limit := a.OutputLimit
	if limit <= 0 {
		limit = defaultOutputLimit
	}
	stdout := newBoundedBuffer(limit)
	stderr := newBoundedBuffer(limit)
	cmd.Stdout = stdout
	cmd.Stderr = stderr
	runErr := cmd.Run()
	if errors.Is(ctx.Err(), context.DeadlineExceeded) {
		return Response{}, runError("timeout", fmt.Errorf("adapter timeout: %w", ctx.Err()))
	}
	if errors.Is(ctx.Err(), context.Canceled) {
		return Response{}, runError("cancelled", fmt.Errorf("adapter cancelled: %w", ctx.Err()))
	}

	var response Response
	if err := json.Unmarshal(stdout.Bytes(), &response); err != nil {
		if runErr != nil {
			return Response{}, runError("operation_failed", fmt.Errorf("adapter exited: %w: %s", runErr, stderr.String()))
		}
		return Response{}, runError("internal_error", fmt.Errorf("decode adapter response: %w", err))
	}
	if err := response.Validate(request); err != nil {
		return Response{}, runError("internal_error", err)
	}
	if (runErr == nil) != response.OK {
		return Response{}, runError("internal_error", fmt.Errorf("adapter exit status contradicts response ok=%t", response.OK))
	}
	return response, nil
}

type boundedBuffer struct {
	buf       bytes.Buffer
	remaining int
}

func newBoundedBuffer(limit int) *boundedBuffer {
	return &boundedBuffer{remaining: limit}
}

func (b *boundedBuffer) Write(p []byte) (int, error) {
	original := len(p)
	if b.remaining > 0 {
		chunk := p
		if len(chunk) > b.remaining {
			chunk = chunk[:b.remaining]
		}
		_, _ = b.buf.Write(chunk)
		b.remaining -= len(chunk)
	}
	return original, nil
}

func (b *boundedBuffer) Bytes() []byte  { return b.buf.Bytes() }
func (b *boundedBuffer) String() string { return b.buf.String() }

var _ io.Writer = (*boundedBuffer)(nil)
