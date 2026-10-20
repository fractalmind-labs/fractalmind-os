package secrets

import (
	"io"
	"regexp"
	"sort"
	"strings"
	"sync"
)

// tokenShapes are credentials recognized by their form even when they were
// never registered, such as a Telegram bot token inside an API URL.
var tokenShapes = []*regexp.Regexp{
	regexp.MustCompile(`\d{6,12}:[A-Za-z0-9_-]{30,}`),    // Telegram bot token, also inside ".../bot<token>/"
	regexp.MustCompile(`\bxox[abprs]-[A-Za-z0-9-]{10,}`), // Slack token
	regexp.MustCompile(`\bxapp-[A-Za-z0-9-]{10,}`),       // Slack app token
	// Connection URLs that carry a short-lived credential, such as the
	// Feishu SDK's websocket endpoint in its connect log.
	regexp.MustCompile(`\b(access_key|ticket|token)=[A-Za-z0-9_.%-]{8,}`),
}

// minRegistered is the shortest value redacted by exact match; shorter values
// would mask ordinary text.
const minRegistered = 6

// Redactor masks secret values in text. Every resolved value is registered;
// logs, status output and errors pass through it.
type Redactor struct {
	mu     sync.RWMutex
	values map[string]string // value -> name
	order  []string          // values, longest first
}

// NewRedactor returns an empty redactor.
func NewRedactor() *Redactor { return &Redactor{values: map[string]string{}} }

// Add registers a value under its secret name.
func (r *Redactor) Add(name, value string) {
	if len(value) < minRegistered {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.values[value]; !ok {
		r.order = append(r.order, value)
		sort.Slice(r.order, func(i, j int) bool { return len(r.order[i]) > len(r.order[j]) })
	}
	r.values[value] = name
}

// Redact masks registered values and known token shapes in s.
func (r *Redactor) Redact(s string) string {
	// Shapes first: a registered value inside a token must not break the
	// token's shape and leave the rest of it readable.
	for _, shape := range tokenShapes {
		s = shape.ReplaceAllString(s, "[redacted]")
	}
	if r != nil {
		r.mu.RLock()
		for _, v := range r.order {
			if strings.Contains(s, v) {
				s = strings.ReplaceAll(s, v, "[secret:"+r.values[v]+"]")
			}
		}
		r.mu.RUnlock()
	}
	return s
}

// Writer returns w with every write redacted. Log output is written one line
// per call, so a value is never split across writes.
func (r *Redactor) Writer(w io.Writer) io.Writer { return redactWriter{r: r, w: w} }

type redactWriter struct {
	r *Redactor
	w io.Writer
}

func (rw redactWriter) Write(p []byte) (int, error) {
	if _, err := io.WriteString(rw.w, rw.r.Redact(string(p))); err != nil {
		return 0, err
	}
	return len(p), nil
}
