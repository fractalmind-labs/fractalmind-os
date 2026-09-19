---
name: golang-web3-service
description: Go Web3 backend service patterns with ERC-4337 Account Abstraction, gas sponsorship policy engine, and production deployment. Covers signing flow orchestration, multi-provider sponsorship with circuit breaker, Prometheus metrics instrumentation, MySQL data layer, Docker EC2 deployment, and health check design. Use when building Web3 wallet APIs, integrating ERC-4337 bundlers/paymasters, implementing gas sponsorship policies, designing transaction tracking systems, or deploying Go services to EC2 with Docker Compose.
---

# Go Web3 Service Development

Build production Web3 backend services in Go with ERC-4337 Account Abstraction and gas sponsorship.

## Quick Start

```go
// Signing flow: authenticate → validate → check policy → sign → sponsor → track
func (h *SigningHandler) Sign(c *gin.Context) {
    user := middleware.GetUser(c)                         // JWT-authenticated
    input := validateSignRequest(c)                       // Validate recipient + calldata
    wallet := h.wallets.LoadAndDecrypt(user.ID)           // AES-256-GCM encrypted keys
    decision := h.sponsorship.Decide(ctx, user, input)    // Policy engine
    result := h.executor.Execute(ctx, wallet, input, decision)  // BEP414 or ERC-4337
    h.repo.StoreSignedTransaction(result)                 // MySQL tracking
}
```

## Core Capabilities

### 1. Service Architecture

**Component Assembly** (dependency injection, no framework):
```go
func main() {
    cfg := config.Load()              // .env + env vars
    db := database.Connect(cfg)       // MySQL 8.0 + GORM
    database.Migrate(db, cfg)         // golang-migrate at startup
    rdb := redis.NewClient(cfg)       // Rate limiting + nonce cache
    chain := ethclient.Dial(cfg.ChainRPCURL)  // EVM RPC
    metrics := metrics.NewPaymasterMetrics()

    // Wire services
    jwt := service.NewJWTService(cfg)
    wallets := service.NewWalletService(db, cfg.EncryptionMasterKey)
    sponsorship := service.NewGasSponsorshipManager(db, rdb, cfg, metrics)
    executor := service.NewSponsorshipExecutorManager(cfg, metrics)

    // Router
    r := gin.New()
    r.Use(gin.Recovery(), gin.Logger(), middleware.CORS())
    health.RegisterRoot(r)    // GET /health
    metrics.RegisterRoot(r)   // GET /metrics
    v1 := r.Group("/api/v1")
    signing.Register(v1)      // POST /api/v1/wallet/sign
    withdrawal.Register(v1)   // POST /api/v1/wallet/withdraw

    // Background jobs
    opResolver := service.NewOperationStatusResolver(db, executor, cfg)
    opResolver.Start()
    defer opResolver.Stop()

    r.Run(":" + cfg.ServerPort)
}
```

**Router Registration Pattern**:
```go
type IRegistrar interface {
    Register(v1 *gin.RouterGroup)
}

type IRootRegistrar interface {
    RegisterRoot(r *gin.Engine)
}
```

**Technology Stack**: Go 1.23, Gin, GORM (MySQL 8.0), go-redis/v9, go-ethereum, golang-jwt/v5, prometheus/client_golang, golang-migrate/v4.

See `references/service-architecture.md` for full component wiring.

### 2. ERC-4337 Account Abstraction

**Provider Configuration** — multi-provider with vendor-specific extensions:
```go
type ERC4337Config struct {
    EntryPoint          string          // 0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789
    AccountFactory      string          // Smart account factory
    Providers           []AAInfraProvider
    Timeout             time.Duration   // 8s
    HealthTTL           time.Duration   // 5m circuit breaker TTL
    ReceiptPollInterval time.Duration   // 2s
    ReceiptPollAttempts int             // 24
}

type AAInfraProvider struct {
    Name         string              // "alchemy-primary"
    ProviderType string              // "alchemy", "biconomy", "self-hosted"
    BundlerURL   string
    PaymasterURL string
    APIKey       string
    BundlerExtraHeaders map[string]string  // Vendor headers
    SponsorContext      json.RawMessage    // Vendor-specific paymaster context
}
```

**Execution Flow**:
```
1. Build UserOperation (sender, nonce, callData, signatures)
2. pm_sponsorUserOperation → get gas estimates from paymaster
3. Sign UserOp with owner's private key
4. eth_sendUserOperation → submit to bundler
5. Poll eth_getUserOperationReceipt (2s intervals, 24 attempts)
6. Store txHash + status in signed_transactions
```

**Provider Health Tracking** — Redis-based circuit breaker:
```go
// Track health per provider in Redis with TTL
key := fmt.Sprintf("aa_provider_health:%s", provider.Name)
rdb.Set(ctx, key, "up", healthTTL)  // Reset on success

// On failure: increment failure counter
failKey := fmt.Sprintf("aa_provider_failures:%s", provider.Name)
count := rdb.Incr(ctx, failKey)
if count >= circuitFailureThreshold {
    rdb.Set(ctx, key, "down", circuitOpenTTL)
}
```

See `references/erc4337-integration.md` for full UserOperation lifecycle.

### 3. Gas Sponsorship Policy Engine

**Policy Model** — hierarchical matching with specificity priority:
```go
type GasSponsorshipPolicy struct {
    Product         string   // "defi", "marketplace"
    OperationType   string   // "sign", "withdrawal"
    ContractAddress *string  // NULL = matches all contracts
    MethodSelector  *string  // NULL = matches all methods
    Enabled         bool
    MaxGasLimit     *int64
    DailyUserLimit  *int     // Per-user daily cap
}
// Match priority: specific contract+selector > contract-only > catch-all
```

**Decision Engine**:
```go
type SponsorshipDecision struct {
    Allowed bool
    Reason  string  // "policy_allow", "daily_limit_reached", "blacklisted"
    Policy  *GasSponsorshipPolicy
}

func (m *GasSponsorshipManager) Decide(ctx, user, product, op, contract, selector string, gasLimit uint64) SponsorshipDecision {
    // 1. Check blacklists (user IDs, addresses, contracts, selectors)
    // 2. Find best matching policy (most specific wins)
    // 3. Check per-user daily limit (via sponsored_transactions_tracker)
    // 4. Check global daily limit
    // 5. Check gas limit cap
    // 6. Return decision with reason
}
```

**Risk Controls**:
```go
type SponsorshipRiskConfig struct {
    GlobalDailyLimit         int           // Budget per operation/product
    Cooldown                 time.Duration // Replay protection
    ReplayWindow             time.Duration // 30s default
    MaxCalldataBytes         int           // 12288 default
    BlacklistedUserIDs       []int64
    BlacklistedContracts     []string
    CircuitFailureThreshold  int           // 5
    CircuitFailureWindow     time.Duration // 2m
    CircuitOpenTTL           time.Duration // 3m
}
```

**Transaction Tracking** — daily per-user counters with UPSERT:
```go
type SponsoredTransactionsTracker struct {
    UserID        int64
    Product       string
    OperationType string
    Date          time.Time   // DATE granularity
    Count         int
}
// Unique key: (user_id, product, operation_type, date)
// Increment uses INSERT ... ON DUPLICATE KEY UPDATE count = count + 1
```

See `references/sponsorship-policy.md` for full policy engine design.

### 4. Signing Flow Orchestration

**Complete Request Flow**:
```
POST /api/v1/wallet/sign
  │
  ├─ [Auth] JWT middleware → load user from DB
  ├─ [Rate Limit] Redis INCR+EXPIRE (20 reqs/min per user)
  ├─ [Whitelist] Check (contract_address, method_selector) against signing_whitelist
  ├─ [Wallet] Load wallet, decrypt private key (AES-256-GCM)
  ├─ [Nonce] Get from blockchain (cached in Redis, 5m TTL)
  ├─ [Policy] GasSponsorshipManager.Decide()
  ├─ [Gas] Estimate gas via eth_estimateGas
  ├─ [Sign] ECDSA sign transaction locally
  ├─ [Execute]
  │   ├─ Sponsored (BEP414): eth_sendRawTransaction to paymaster
  │   ├─ Sponsored (ERC-4337): Build UserOp → pm_sponsor → eth_sendUserOp
  │   └─ User-paid: eth_sendRawTransaction to chain RPC
  ├─ [Store] signed_transactions (status=pending, gas_mode, sponsorship_mode)
  └─ [Return] operationId for async polling
```

**Signed Transaction Record**:
```go
type SignedTransaction struct {
    UserID              int64
    UserAddress         string
    ToAddress           string
    MethodSelector      *string
    Product             string
    TxHash              *string
    GasMode             string   // "sponsored" or "user-paid"
    SponsorshipMode     *string  // "bep414" or "erc4337"
    SponsorshipProvider *string
    UserOpHash          *string  // For ERC-4337 async resolution
    Status              string   // "pending" → "confirmed" / "failed"
}
```

**Background Status Resolver** — polls receipts for pending transactions:
```go
type OperationStatusResolver struct {
    batchSize         int           // 100
    unresolvedTimeout time.Duration // 30m
}

func (r *OperationStatusResolver) RunOnce(ctx context.Context) {
    candidates := r.repo.FindPendingSponsoredUserOpCandidates(batchSize)
    for _, item := range candidates {
        txHash, status, resolved := r.resolver.ResolveUserOperation(ctx, item.UserOpHash)
        if resolved {
            r.repo.UpdateTxHashStatusAndSponsorshipStatus(item.ID, txHash, status, "resolved")
        }
    }
}
```

See `references/signing-flow.md` for error handling and retry patterns.

### 5. Prometheus Metrics

**Namespace Convention**: `wallet_service_<subsystem>_<metric>`

```go
type PaymasterMetrics struct {
    // Provider health (gauge: 0/1)
    SponsorshipProviderUp       *prometheus.GaugeVec       // {mode, provider}
    SponsorshipAllProvidersDown *prometheus.GaugeVec       // {mode}

    // Request counters
    SponsorshipSendAttempts     *prometheus.CounterVec     // {mode, provider}
    SponsorshipSendFailures     *prometheus.CounterVec     // {mode, provider, error_class}

    // Latency histogram
    SponsorshipSendLatencyMs    *prometheus.HistogramVec   // {mode, provider, stage}

    // Policy decisions
    SponsorshipPolicyDecisions  *prometheus.CounterVec     // {operation, product, result, reason}

    // Circuit breaker state
    SponsorshipCircuitOpen      *prometheus.GaugeVec       // {operation, product}

    // Fallback tracking
    SponsorshipFallbacks        *prometheus.CounterVec     // {from_mode, to_mode, reason}
}
```

**Key Queries for Monitoring**:
```promql
# Sponsorship success rate
rate(wallet_service_sponsorship_send_attempts_total[5m])
  - rate(wallet_service_sponsorship_send_failures_total[5m])

# Provider health
wallet_service_sponsorship_provider_up{mode="erc4337"}

# Policy decision distribution
sum by (result, reason) (rate(wallet_service_sponsorship_policy_decisions_total[1h]))

# P99 latency
histogram_quantile(0.99, rate(wallet_service_sponsorship_send_latency_ms_bucket[5m]))
```

See `references/metrics-instrumentation.md` for registration patterns and alerting rules.

### 6. Health Check & Deployment

**Three-Component Health Check**:
```go
func (h *HealthHandler) Health(c *gin.Context) {
    dbOK := pingDB(h.sqlDB, 2*time.Second)
    redisOK := pingRedis(h.redis, 2*time.Second)
    chainOK := checkChainID(h.chain, 2*time.Second)

    status := "healthy"
    httpCode := 200
    if !dbOK {
        status, httpCode = "unhealthy", 503
    } else if !redisOK || !chainOK {
        status = "degraded"  // Still 200 — DB is the hard dependency
    }

    c.JSON(httpCode, gin.H{
        "status":        status,
        "version":       h.version,
        "uptimeSeconds": time.Since(h.startTime).Seconds(),
        "database":      componentStatus{OK: dbOK},
        "redis":         componentStatus{OK: redisOK},
        "chain":         componentStatus{OK: chainOK},
    })
}
```

**Docker Compose (EC2 Production)**:
```yaml
services:
  mysql:
    image: mysql:8.0
    logging:
      driver: json-file
      options: { max-size: "1024m", max-file: "3" }
    healthcheck:
      test: ["CMD-SHELL", "mysqladmin ping -h 127.0.0.1 -uroot -p$$MYSQL_ROOT_PASSWORD"]
      interval: 5s
      retries: 20

  redis:
    image: redis:7-alpine
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]

  api:
    build: .
    depends_on:
      mysql: { condition: service_healthy }
      redis: { condition: service_healthy }
    healthcheck:
      test: ["CMD-SHELL", "wget -qO- http://127.0.0.1:8080/health"]
      interval: 10s
    logging:
      driver: json-file
      options: { max-size: "1024m", max-file: "3" }  # Prevent disk fill
```

**Dockerfile** (multi-stage, non-root):
```dockerfile
FROM golang:1.23-alpine AS builder
  RUN apk add --no-cache ca-certificates
  COPY go.mod go.sum ./
  RUN go mod download
  COPY . .
  RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/api ./cmd/api

FROM alpine:3.20
  RUN addgroup -g 65532 -S nonroot && adduser -S -D -H -u 65532 -G nonroot nonroot
  COPY --from=builder /out/api /app/api
  COPY --from=builder /src/migrations /app/migrations
  USER nonroot
  ENTRYPOINT ["/app/api"]
```

**Production Lesson**: Always set logging driver `max-size` and `max-file` on all containers. Without log rotation, service logs can fill disk within days under heavy sponsorship traffic.

See `references/deployment-patterns.md` for CI/CD workflow and SSH diagnostics.

## Decision Framework

| Scenario | Pattern | Reference |
|----------|---------|-----------|
| New sponsorship provider | Add to AAInfraProvider list + health tracking | `references/erc4337-integration.md` |
| Per-user rate limiting | Redis INCR+EXPIRE with sliding window | `references/signing-flow.md` |
| Gas sponsorship abuse | Policy engine + blacklists + daily limits | `references/sponsorship-policy.md` |
| Provider outage | Circuit breaker + cross-mode fallback | `references/erc4337-integration.md` |
| Transaction status tracking | Background resolver with configurable polling | `references/signing-flow.md` |
| Disk full from logs | Docker json-file driver with max-size/max-file | `references/deployment-patterns.md` |
| Debug sponsorship spending | SSH DB diagnostic workflow | `references/deployment-patterns.md` |
| New contract whitelist entry | Insert into signing_whitelist table | `references/signing-flow.md` |

## Resources

- `references/service-architecture.md` — Component assembly, config loading, middleware chain
- `references/erc4337-integration.md` — UserOperation lifecycle, provider config, circuit breaker
- `references/sponsorship-policy.md` — Policy engine, risk controls, transaction tracking
- `references/signing-flow.md` — Request flow, whitelist, nonce management, error handling
- `references/metrics-instrumentation.md` — Prometheus metrics, namespace conventions, alerting
- `references/deployment-patterns.md` — Docker Compose, Dockerfile, CI/CD, log rotation, diagnostics
