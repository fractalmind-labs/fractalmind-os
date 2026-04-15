# Gas Sponsorship Policy Engine

## Policy Model

Policies define which transactions qualify for gas sponsorship:

```go
type GasSponsorshipPolicy struct {
    ID              int64
    Product         string   // "defi", "marketplace" — groups of contracts
    OperationType   string   // "sign", "withdrawal"
    ContractAddress *string  // NULL = matches all contracts for this product
    MethodSelector  *string  // NULL = matches all methods on this contract
    Enabled         bool
    MaxGasLimit     *int64   // Maximum gas this policy allows (NULL = unlimited)
    DailyUserLimit  *int     // Per-user daily operations (NULL = unlimited)
}
```

### Policy Matching Rules

Policies are matched by specificity (most specific wins):

```
Priority 1: product + operation + contract + selector (exact match)
Priority 2: product + operation + contract + NULL selector (any method)
Priority 3: product + operation + NULL contract + NULL selector (any target)
```

If multiple policies match at the same specificity, the most recently created one wins (ORDER BY id DESC).

```go
func (r *PolicyRepo) FindBestMatch(product, operation, contract, selector string) (*Policy, error) {
    return r.db.Where(
        "(product = ? OR product = 'shared') AND operation_type = ? AND enabled = true AND "+
        "(contract_address = ? OR contract_address IS NULL) AND "+
        "(method_selector = ? OR method_selector IS NULL)",
        product, operation, contract, selector,
    ).Order(
        "CASE WHEN contract_address IS NOT NULL THEN 0 ELSE 1 END, " +
        "CASE WHEN method_selector IS NOT NULL THEN 0 ELSE 1 END, " +
        "id DESC",
    ).First(&policy).Error
}
```

## Decision Engine

```go
type SponsorshipDecision struct {
    Allowed bool
    Reason  string
    Policy  *GasSponsorshipPolicy
}

func (m *Manager) Decide(ctx, user, product, op, contract, selector string, gasLimit uint64) SponsorshipDecision {
    // 1. Blacklist checks
    if m.isBlacklisted(user, contract, selector) {
        return SponsorshipDecision{Allowed: false, Reason: "blacklisted"}
    }

    // 2. Calldata size check
    if calldataSize > m.risk.MaxCalldataBytes {
        return SponsorshipDecision{Allowed: false, Reason: "calldata_too_large"}
    }

    // 3. Replay protection (cooldown between identical calls)
    if m.isReplay(ctx, user.ID, contract, selector) {
        return SponsorshipDecision{Allowed: false, Reason: "replay_cooldown"}
    }

    // 4. Find matching policy
    policy, err := m.policyRepo.FindBestMatch(product, op, contract, selector)
    if err != nil || policy == nil {
        return SponsorshipDecision{Allowed: false, Reason: "no_matching_policy"}
    }

    // 5. Gas limit check
    if policy.MaxGasLimit != nil && gasLimit > uint64(*policy.MaxGasLimit) {
        return SponsorshipDecision{Allowed: false, Reason: "gas_limit_exceeded"}
    }

    // 6. Per-user daily limit
    if policy.DailyUserLimit != nil {
        count := m.tracker.GetCount(user.ID, product, op, today())
        if count >= *policy.DailyUserLimit {
            return SponsorshipDecision{Allowed: false, Reason: "daily_limit_reached"}
        }
    }

    // 7. Global daily limit
    if m.risk.GlobalDailyLimit > 0 {
        globalCount := m.tracker.GetGlobalCount(product, op, today())
        if globalCount >= m.risk.GlobalDailyLimit {
            return SponsorshipDecision{Allowed: false, Reason: "global_limit_reached"}
        }
    }

    // 8. Circuit breaker
    if m.isCircuitOpen(ctx, product, op) {
        return SponsorshipDecision{Allowed: false, Reason: "circuit_open"}
    }

    return SponsorshipDecision{Allowed: true, Reason: "policy_allow", Policy: policy}
}
```

## Risk Controls

```go
type SponsorshipRiskConfig struct {
    // Feature flags
    EnforcePolicyDecision    bool          // If false, sponsor all (for testing)
    SignEnabled              bool          // Enable sponsorship for sign operations
    WithdrawalEnabled        bool          // Enable for withdrawals

    // Limits
    GlobalDailyLimit         int           // Global budget per operation/product
    MaxCalldataBytes         int           // 12288 default (12KB)

    // Replay protection
    Cooldown                 time.Duration // Min time between identical calls
    ReplayWindow             time.Duration // 30s default

    // Blacklists
    BlacklistedUserIDs       []int64
    BlacklistedUserAddresses []string
    BlacklistedContracts     []string
    BlacklistedSelectors     []string

    // Circuit breaker
    CircuitFailureThreshold  int           // 5 failures to open
    CircuitFailureWindow     time.Duration // Within 2 minutes
    CircuitOpenTTL           time.Duration // Stay open for 3 minutes
}
```

## Transaction Tracking

Daily per-user counters with UPSERT for efficient counting:

```go
type SponsoredTransactionsTracker struct {
    UserID        int64
    UserAddress   string
    Product       string
    OperationType string
    Date          time.Time  // DATE granularity (not timestamp)
    Count         int
}

func (r *TrackerRepo) Increment(userID int64, address, product, op string, date time.Time) error {
    return r.db.Exec(`
        INSERT INTO sponsored_transactions_tracker
            (user_id, user_address, product, operation_type, date, count, updated_at)
        VALUES (?, ?, ?, ?, ?, 1, NOW())
        ON DUPLICATE KEY UPDATE count = count + 1, updated_at = NOW()
    `, userID, address, product, op, date).Error
}

func (r *TrackerRepo) GetCount(userID int64, product, op string, date time.Time) (int, error) {
    var count int
    r.db.Model(&SponsoredTransactionsTracker{}).
        Where("user_id = ? AND product = ? AND operation_type = ? AND date = ?",
            userID, product, op, date).
        Select("COALESCE(SUM(count), 0)").
        Scan(&count)
    return count, nil
}
```

## Replay Protection

Prevents users from spamming identical calls:

```go
func (m *Manager) isReplay(ctx context.Context, userID int64, contract, selector string) bool {
    key := fmt.Sprintf("sponsorship_replay:%d:%s:%s", userID, contract, selector)
    set, _ := m.rdb.SetNX(ctx, key, "1", m.risk.ReplayWindow).Result()
    return !set  // If key already exists, it's a replay
}
```

## Metrics Integration

Every decision is recorded for monitoring:

```go
func (m *Manager) recordDecision(decision SponsorshipDecision, product, op string) {
    result := "deny"
    if decision.Allowed {
        result = "allow"
    }
    m.metrics.SponsorshipPolicyDecisions.WithLabelValues(
        op, product, result, decision.Reason,
    ).Inc()
}
```

Key PromQL queries:
```promql
# Sponsorship deny rate by reason
sum by (reason) (rate(wallet_service_sponsorship_policy_decisions_total{result="deny"}[1h]))

# Per-product daily sponsorship volume
sum by (product) (increase(wallet_service_sponsorship_policy_decisions_total{result="allow"}[24h]))
```

## Contract Whitelist

Additional layer: only whitelisted (contract, method) pairs are allowed:

```sql
CREATE TABLE signing_whitelist (
    contract_address VARCHAR(42) NOT NULL,
    method_selector  VARCHAR(10) NOT NULL,
    method_name      VARCHAR(64),
    product          VARCHAR(32) NOT NULL,
    enabled          BOOLEAN DEFAULT TRUE,
    UNIQUE KEY (contract_address, method_selector)
);
```

Checked before policy evaluation:
```go
func (h *SigningHandler) Sign(c *gin.Context) {
    // ...
    if !h.whitelist.IsAllowed(input.To, input.MethodSelector()) {
        c.JSON(403, AppError{Code: "forbidden", Message: "contract/method not whitelisted"})
        return
    }
    // Continue to sponsorship policy check...
}
```
