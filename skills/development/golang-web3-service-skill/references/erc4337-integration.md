# ERC-4337 Account Abstraction Integration

## Overview

ERC-4337 enables gasless transactions by routing UserOperations through a Bundler, with a Paymaster sponsoring gas costs. The service supports multiple AA infrastructure providers with automatic failover.

## Provider Configuration

```go
type AAInfraProvider struct {
    Name         string              // "alchemy-primary", "biconomy-backup"
    ChainID      int64               // e.g., 1 (Ethereum), 56 (BSC), 137 (Polygon)
    ProviderType string              // "alchemy", "biconomy", "self-hosted"
    BundlerURL   string              // Bundler JSON-RPC endpoint
    PaymasterURL string              // Paymaster JSON-RPC endpoint
    APIKey       string
    BundlerExtraHeaders map[string]string  // e.g., {"Alchemy-AA-Sdk-Version": "2.0"}
    SponsorContext      json.RawMessage    // Vendor-specific paymaster context
    SponsorUserOpGasFormat string          // "hex" or "decimal"
}
```

### Alchemy Example
```env
ERC4337_PROVIDERS_0_NAME=alchemy-primary
ERC4337_PROVIDERS_0_PROVIDER_TYPE=alchemy
ERC4337_PROVIDERS_0_BUNDLER_URL=https://eth-mainnet.g.alchemy.com/v2/KEY
ERC4337_PROVIDERS_0_PAYMASTER_URL=https://eth-mainnet.g.alchemy.com/v2/KEY
ERC4337_PROVIDERS_0_API_KEY=KEY
ERC4337_PROVIDERS_0_SPONSOR_PATH=alchemy_bundler_header
```

## UserOperation Lifecycle

### 1. Build UserOperation

```go
type UserOperation struct {
    Sender               common.Address
    Nonce                *big.Int
    InitCode             []byte      // Empty for existing accounts
    CallData             []byte      // Encoded contract call
    CallGasLimit         *big.Int
    VerificationGasLimit *big.Int
    PreVerificationGas   *big.Int
    MaxFeePerGas         *big.Int
    MaxPriorityFeePerGas *big.Int
    PaymasterAndData     []byte      // Set by paymaster
    Signature            []byte      // Owner signature
}
```

### 2. Sponsor UserOperation

```go
// JSON-RPC call to paymaster
request := JSONRPCRequest{
    Method: "pm_sponsorUserOperation",
    Params: []any{
        userOp,
        entryPointAddress,
        sponsorContext,  // Vendor-specific (e.g., Alchemy policy ID)
    },
}

// Response updates gas fields
type SponsorResult struct {
    PaymasterAndData     string
    CallGasLimit         string  // May be hex or decimal depending on provider
    VerificationGasLimit string
    PreVerificationGas   string
}
```

### 3. Sign UserOperation

```go
// EIP-712 typed data hash for EntryPoint v0.6
func hashUserOp(op UserOperation, entryPoint common.Address, chainID *big.Int) common.Hash {
    packed := abi.encodePacked(
        op.Sender, op.Nonce, keccak256(op.InitCode), keccak256(op.CallData),
        op.CallGasLimit, op.VerificationGasLimit, op.PreVerificationGas,
        op.MaxFeePerGas, op.MaxPriorityFeePerGas, keccak256(op.PaymasterAndData),
    )
    return keccak256(abi.encodePacked(
        "\x19\x01",
        entryPoint,
        chainID,
        keccak256(packed),
    ))
}
```

### 4. Send UserOperation

```go
request := JSONRPCRequest{
    Method: "eth_sendUserOperation",
    Params: []any{userOp, entryPointAddress},
}
// Returns userOpHash (not txHash)
```

### 5. Poll for Receipt

```go
func (e *ERC4337Executor) pollReceipt(ctx context.Context, userOpHash string) (string, string, error) {
    for attempt := 0; attempt < e.config.ReceiptPollAttempts; attempt++ {
        time.Sleep(e.config.ReceiptPollInterval)  // 2s default

        result := e.rpc("eth_getUserOperationReceipt", userOpHash)
        if result != nil {
            txHash := result["receipt"]["transactionHash"]
            success := result["success"]
            if success {
                return txHash, "confirmed", nil
            }
            return txHash, "failed", nil
        }
    }
    return "", "pending", nil  // Will be resolved by background job
}
```

## Provider Health & Circuit Breaker

Track provider health in Redis to avoid repeated failures:

```go
const (
    healthKeyPrefix  = "aa_provider_health:"
    failureKeyPrefix = "aa_provider_failures:"
)

func (e *ERC4337Executor) isProviderHealthy(ctx context.Context, name string) bool {
    val, _ := e.rdb.Get(ctx, healthKeyPrefix+name).Result()
    return val != "down"
}

func (e *ERC4337Executor) recordFailure(ctx context.Context, name string) {
    key := failureKeyPrefix + name
    count, _ := e.rdb.Incr(ctx, key).Result()
    e.rdb.Expire(ctx, key, e.config.CircuitFailureWindow)  // 2m

    if count >= int64(e.config.CircuitFailureThreshold) {  // 5
        e.rdb.Set(ctx, healthKeyPrefix+name, "down", e.config.CircuitOpenTTL)  // 3m
        e.metrics.SponsorshipProviderUp.WithLabelValues("erc4337", name).Set(0)
    }
}

func (e *ERC4337Executor) recordSuccess(ctx context.Context, name string) {
    e.rdb.Del(ctx, failureKeyPrefix+name)
    e.rdb.Set(ctx, healthKeyPrefix+name, "up", e.config.HealthTTL)  // 5m
    e.metrics.SponsorshipProviderUp.WithLabelValues("erc4337", name).Set(1)
}
```

## Multi-Provider Fallback

```go
func (e *ERC4337Executor) Execute(ctx context.Context, in SponsoredExecutionInput) (result, error) {
    for _, provider := range e.config.Providers {
        if !e.isProviderHealthy(ctx, provider.Name) {
            continue
        }

        res, err := e.executeWithProvider(ctx, in, provider)
        if err == nil {
            e.recordSuccess(ctx, provider.Name)
            return res, nil
        }

        e.recordFailure(ctx, provider.Name)
        e.metrics.SponsorshipSendFailures.WithLabelValues("erc4337", provider.Name, classifyError(err)).Inc()
    }

    e.metrics.SponsorshipAllProvidersDown.WithLabelValues("erc4337").Set(1)
    return result{}, ErrAllProvidersDown
}
```

## Cross-Mode Fallback

When ERC-4337 fails, fall back to BEP-414 (or vice versa):

```go
type SponsorshipExecutorManager struct {
    primaryMode       string  // "erc4337"
    crossModeFallback bool    // true
    executors         map[string]SponsoredExecutor
}

func (m *SponsorshipExecutorManager) Execute(ctx, in) (result, error) {
    res, err := m.executors[m.primaryMode].Execute(ctx, in)
    if err == nil {
        return res, nil
    }

    if m.crossModeFallback {
        altMode := alternateMode(m.primaryMode)
        m.metrics.SponsorshipFallbacks.WithLabelValues(m.primaryMode, altMode, err.Error()).Inc()
        return m.executors[altMode].Execute(ctx, in)
    }
    return result{}, err
}
```

## Smart Account Address Resolution

For ERC-4337, the effective sender is a smart account (not the EOA owner):

```go
func (m *SponsorshipExecutorManager) ResolveSender(ctx context.Context, chainID int64, owner string) (string, error) {
    if m.primaryMode == "erc4337" {
        // Call AccountFactory.getAddress(owner, salt=0)
        return m.executors["erc4337"].(*ERC4337Executor).GetSmartAccountAddress(ctx, owner)
    }
    return owner, nil  // BEP414 uses EOA directly
}
```

## Key Constants

```go
const (
    DefaultTimeout             = 8 * time.Second
    DefaultHealthTTL           = 5 * time.Minute
    DefaultReceiptPollInterval = 2 * time.Second
    DefaultReceiptPollAttempts = 24
    DefaultCircuitThreshold    = 5
    DefaultCircuitWindow       = 2 * time.Minute
    DefaultCircuitOpenTTL      = 3 * time.Minute

    EntryPointV06 = "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789"
)
```
