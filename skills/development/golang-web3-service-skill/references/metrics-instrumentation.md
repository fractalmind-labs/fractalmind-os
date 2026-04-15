# Prometheus Metrics Instrumentation

## Namespace Convention

All metrics follow: `wallet_service_<subsystem>_<metric_name>`

```go
const namespace = "wallet_service"
```

## Metrics Registration

```go
type PaymasterMetrics struct {
    // Provider health gauges
    SponsorshipProviderUp *prometheus.GaugeVec
    SponsorshipAllProvidersDown *prometheus.GaugeVec

    // Request counters
    SponsorshipSendAttempts *prometheus.CounterVec
    SponsorshipSendFailures *prometheus.CounterVec

    // Latency histogram
    SponsorshipSendLatencyMs *prometheus.HistogramVec

    // Policy decisions
    SponsorshipPolicyDecisions *prometheus.CounterVec

    // Circuit breaker
    SponsorshipCircuitOpen *prometheus.GaugeVec

    // Fallback tracking
    SponsorshipFallbacks *prometheus.CounterVec

    // Background jobs
    OperationStatusResolverEvents *prometheus.CounterVec
}

func NewPaymasterMetrics() *PaymasterMetrics {
    m := &PaymasterMetrics{
        SponsorshipProviderUp: promauto.NewGaugeVec(
            prometheus.GaugeOpts{
                Namespace: namespace,
                Subsystem: "sponsorship",
                Name:      "provider_up",
                Help:      "Whether a sponsorship provider is healthy (1=up, 0=down)",
            },
            []string{"mode", "provider"},
        ),
        SponsorshipSendAttempts: promauto.NewCounterVec(
            prometheus.CounterOpts{
                Namespace: namespace,
                Subsystem: "sponsorship",
                Name:      "send_attempts_total",
                Help:      "Total sponsorship send attempts",
            },
            []string{"mode", "provider"},
        ),
        SponsorshipSendFailures: promauto.NewCounterVec(
            prometheus.CounterOpts{
                Namespace: namespace,
                Subsystem: "sponsorship",
                Name:      "send_failures_total",
                Help:      "Total sponsorship send failures",
            },
            []string{"mode", "provider", "error_class"},
        ),
        SponsorshipSendLatencyMs: promauto.NewHistogramVec(
            prometheus.HistogramOpts{
                Namespace: namespace,
                Subsystem: "sponsorship",
                Name:      "send_latency_ms",
                Help:      "Sponsorship send latency in milliseconds",
                Buckets:   []float64{50, 100, 250, 500, 1000, 2000, 5000, 10000},
            },
            []string{"mode", "provider", "stage"},
        ),
        SponsorshipPolicyDecisions: promauto.NewCounterVec(
            prometheus.CounterOpts{
                Namespace: namespace,
                Subsystem: "sponsorship",
                Name:      "policy_decisions_total",
                Help:      "Total sponsorship policy decisions",
            },
            []string{"operation", "product", "result", "reason"},
        ),
        // ... more metrics
    }
    return m
}
```

## Instrumentation Points

### Sponsorship Execution

```go
func (e *Executor) Execute(ctx, in) (result, error) {
    start := time.Now()
    e.metrics.SponsorshipSendAttempts.WithLabelValues(mode, provider).Inc()

    result, err := e.doExecute(ctx, in, provider)
    elapsed := float64(time.Since(start).Milliseconds())

    if err != nil {
        errClass := classifyError(err)  // "timeout", "rpc_error", "rejected", "unknown"
        e.metrics.SponsorshipSendFailures.WithLabelValues(mode, provider, errClass).Inc()
        e.metrics.SponsorshipSendLatencyMs.WithLabelValues(mode, provider, "error").Observe(elapsed)
        return result, err
    }

    e.metrics.SponsorshipSendLatencyMs.WithLabelValues(mode, provider, "success").Observe(elapsed)
    return result, nil
}
```

### Policy Decisions

```go
func (m *Manager) Decide(...) SponsorshipDecision {
    decision := m.evaluate(...)
    result := "deny"
    if decision.Allowed { result = "allow" }
    m.metrics.SponsorshipPolicyDecisions.WithLabelValues(
        operation, product, result, decision.Reason,
    ).Inc()
    return decision
}
```

### Health Endpoint as Metrics Source

```go
// GET /metrics — Prometheus scrape endpoint
func (m *PaymasterMetrics) RegisterRoot(r *gin.Engine) {
    r.GET("/metrics", gin.WrapH(promhttp.Handler()))
}
```

## Key PromQL Queries

```promql
# Success rate over 5 minutes
1 - (
    rate(wallet_service_sponsorship_send_failures_total[5m])
    / rate(wallet_service_sponsorship_send_attempts_total[5m])
)

# Provider health status
wallet_service_sponsorship_provider_up

# All providers down (critical alert)
wallet_service_sponsorship_all_providers_down == 1

# Policy deny rate by reason (hourly)
sum by (reason) (
    rate(wallet_service_sponsorship_policy_decisions_total{result="deny"}[1h])
)

# P99 send latency
histogram_quantile(0.99,
    rate(wallet_service_sponsorship_send_latency_ms_bucket[5m])
)

# Daily sponsored transaction volume
sum(increase(
    wallet_service_sponsorship_policy_decisions_total{result="allow"}[24h]
))

# Circuit breaker state
wallet_service_sponsorship_circuit_open

# Cross-mode fallback rate
rate(wallet_service_sponsorship_fallbacks_total[1h])

# Operation resolver throughput
rate(wallet_service_sponsorship_operation_status_resolver_events_total[5m])
```

## Alerting Rules

```yaml
groups:
  - name: wallet_service
    rules:
      - alert: AllSponsorshipProvidersDown
        expr: wallet_service_sponsorship_all_providers_down == 1
        for: 2m
        labels:
          severity: critical
        annotations:
          summary: "All sponsorship providers are down"

      - alert: HighSponsorshipFailureRate
        expr: |
          rate(wallet_service_sponsorship_send_failures_total[5m])
          / rate(wallet_service_sponsorship_send_attempts_total[5m])
          > 0.1
        for: 5m
        labels:
          severity: warning

      - alert: SponsorshipLatencyP99High
        expr: |
          histogram_quantile(0.99,
            rate(wallet_service_sponsorship_send_latency_ms_bucket[5m])
          ) > 5000
        for: 5m
        labels:
          severity: warning

      - alert: CircuitBreakerOpen
        expr: wallet_service_sponsorship_circuit_open == 1
        for: 1m
        labels:
          severity: warning
```

## Process Uptime Metric

The standard `process_start_time_seconds` metric is automatically exposed by `prometheus/client_golang`. Use it to detect restarts:

```promql
# Uptime in hours
(time() - process_start_time_seconds) / 3600

# Detect recent restart (within 10 minutes)
(time() - process_start_time_seconds) < 600
```

**Production note**: Counter metrics reset on process restart. When analyzing historical data, use `increase()` or `rate()` which handle counter resets automatically. For absolute counts, query the database (sponsored_transactions_tracker table) instead of Prometheus.
