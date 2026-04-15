# Signing Flow

## Complete Request Flow

```
POST /api/v1/wallet/sign
  │
  ├─ [1. Auth] JWT middleware extracts Bearer token
  │   → Parse JWT claims (user ID, expiry)
  │   → Load user from DB by ID
  │   → Set user in Gin context
  │
  ├─ [2. Rate Limit] Redis sliding window
  │   → Key: "rl:sign:{user_id}:{window_start}"
  │   → INCR + EXPIRE (20 reqs/min default)
  │   → 429 with Retry-After header if exceeded
  │
  ├─ [3. Validate Request]
  │   → Validate To address (checksum, non-zero)
  │   → Validate Data (hex-encoded calldata)
  │   → Extract method selector (first 4 bytes)
  │   → Validate Value (wei amount, non-negative)
  │
  ├─ [4. Whitelist Check]
  │   → Query signing_whitelist table
  │   → Match (contract_address, method_selector, product)
  │   → 403 if not whitelisted
  │
  ├─ [5. Load Wallet]
  │   → Query wallets by user_id
  │   → Decrypt private key: AES-256-GCM(master_key, per_wallet_salt, ciphertext)
  │   → Private key in memory only, zeroed after use
  │
  ├─ [6. Resolve Sender]
  │   → For ERC-4337: derive smart account address from EOA owner
  │   → For BEP414/direct: use EOA address
  │
  ├─ [7. Sponsorship Decision]
  │   → GasSponsorshipManager.Decide(user, product, op, contract, selector, gasLimit)
  │   → Returns: {Allowed, Reason, Policy}
  │
  ├─ [8. Estimate Gas]
  │   → eth_estimateGas with from, to, data, value
  │   → Apply gas limit cap from policy if applicable
  │
  ├─ [9. Build & Sign Transaction]
  │   → Get nonce (Redis cache or eth_getTransactionCount)
  │   → Build transaction (to, data, value, gas, gasPrice/EIP-1559)
  │   → ECDSA sign with private key
  │   → RLP encode raw transaction
  │
  ├─ [10. Execute]
  │   ├─ Sponsored + BEP414:
  │   │   → eth_sendRawTransaction to paymaster provider
  │   │   → Returns txHash immediately
  │   ├─ Sponsored + ERC-4337:
  │   │   → Build UserOperation from signed tx
  │   │   → pm_sponsorUserOperation → get gas + paymasterAndData
  │   │   → Sign UserOp hash
  │   │   → eth_sendUserOperation → get userOpHash
  │   │   → Poll eth_getUserOperationReceipt (2s × 24 attempts)
  │   └─ Not Sponsored:
  │       → eth_sendRawTransaction to chain RPC
  │       → Returns txHash immediately
  │
  ├─ [11. Store Record]
  │   → INSERT signed_transactions (user_id, to, method_selector, product,
  │       tx_hash, gas_mode, sponsorship_mode, sponsorship_provider,
  │       user_op_hash, status=pending)
  │   → Increment sponsored_transactions_tracker (if sponsored)
  │
  └─ [12. Return Response]
      → { operationId, txHash, hashType, gasMode, status, createdAt }
```

## Nonce Management

```go
// Redis-cached nonce with fallback to RPC
func (s *NonceManager) GetNonce(ctx context.Context, address string) (uint64, error) {
    key := "nonce:" + address
    cached, err := s.rdb.Get(ctx, key).Uint64()
    if err == nil {
        // Increment cached nonce
        s.rdb.Incr(ctx, key)
        return cached, nil
    }
    // Fallback to RPC
    nonce, err := s.chain.PendingNonceAt(ctx, common.HexToAddress(address))
    if err != nil {
        return 0, err
    }
    s.rdb.Set(ctx, key, nonce+1, 5*time.Minute)
    return nonce, nil
}
```

## Private Key Security

```go
// Encryption: AES-256-GCM with per-wallet salt
func Encrypt(masterKey []byte, plaintext []byte) (salt, ciphertext []byte, err error) {
    salt = make([]byte, 32)
    io.ReadFull(rand.Reader, salt)
    key := deriveKey(masterKey, salt)  // HKDF-SHA256
    block, _ := aes.NewCipher(key)
    gcm, _ := cipher.NewGCM(block)
    nonce := make([]byte, gcm.NonceSize())
    io.ReadFull(rand.Reader, nonce)
    ciphertext = gcm.Seal(nonce, nonce, plaintext, nil)
    return
}

// Decryption: extract nonce from ciphertext prefix
func Decrypt(masterKey, salt, ciphertext []byte) ([]byte, error) {
    key := deriveKey(masterKey, salt)
    block, _ := aes.NewCipher(key)
    gcm, _ := cipher.NewGCM(block)
    nonce := ciphertext[:gcm.NonceSize()]
    return gcm.Open(nil, nonce, ciphertext[gcm.NonceSize():], nil)
}
```

Security rules:
- Master key: 32-byte hex from `ENCRYPTION_MASTER_KEY` env var
- Per-wallet salt stored alongside encrypted private key in DB
- Decrypted private key: in-memory only, never logged, zeroed after use
- No private key in request/response payloads

## Operation Status Polling

Client polls for transaction completion:

```go
// GET /api/v1/wallet/operations/:operationId
func (h *SigningHandler) GetOperationStatus(c *gin.Context) {
    id := c.Param("operationId")
    tx, err := h.repo.FindByID(id)
    if err != nil {
        c.JSON(404, AppError{Code: "not_found"})
        return
    }
    // Verify user owns this operation
    if tx.UserID != middleware.GetUser(c).ID {
        c.JSON(403, AppError{Code: "forbidden"})
        return
    }
    c.JSON(200, gin.H{
        "operationId": tx.ID,
        "txHash":      tx.TxHash,
        "status":      tx.Status,  // "pending", "confirmed", "failed"
        "gasMode":     tx.GasMode,
        "createdAt":   tx.CreatedAt,
        "updatedAt":   tx.UpdatedAt,
    })
}
```

## Background Status Resolver

Resolves pending ERC-4337 UserOperations that weren't confirmed during initial polling:

```go
type OperationStatusResolver struct {
    batchSize         int           // 100 per run
    interval          time.Duration // 10s between runs
    unresolvedTimeout time.Duration // 30m before marking failed
}

func (r *OperationStatusResolver) RunOnce(ctx context.Context) (Result, error) {
    // Find pending sponsored transactions with userOpHash
    candidates := r.repo.FindPendingSponsoredUserOpCandidates(r.batchSize)

    resolved, failed, timedOut := 0, 0, 0
    for _, item := range candidates {
        // Check if timed out
        if time.Since(item.CreatedAt) > r.unresolvedTimeout {
            r.repo.UpdateStatus(item.ID, "failed", "timeout")
            timedOut++
            continue
        }

        // Poll receipt
        txHash, status, ok := r.resolver.ResolveUserOperation(ctx, item.UserOpHash)
        if ok {
            r.repo.UpdateTxHashStatusAndSponsorshipStatus(item.ID, txHash, status, "resolved")
            if status == "confirmed" { resolved++ } else { failed++ }
        }
    }

    r.metrics.OperationStatusResolverEvents.WithLabelValues("resolved").Add(float64(resolved))
    r.metrics.OperationStatusResolverEvents.WithLabelValues("failed").Add(float64(failed))
    r.metrics.OperationStatusResolverEvents.WithLabelValues("timeout").Add(float64(timedOut))
    return Result{Resolved: resolved, Failed: failed, TimedOut: timedOut}, nil
}
```

## Withdrawal Flow

Similar to signing but with additional balance and daily limit checks:

```go
func (h *WithdrawalHandler) Withdraw(c *gin.Context) {
    // 1-4: Same auth, rate limit, validate, whitelist
    // 5: Check daily withdrawal limit
    tracker := h.repo.GetDailyWithdrawal(user.ID, input.Asset, today())
    remaining := dailyLimit - tracker.TotalWithdrawn
    if input.Amount > remaining {
        c.JSON(400, AppError{Message: "daily limit exceeded"})
        return
    }
    // 6: Check on-chain balance
    balance := getBalance(wallet.Address, input.Asset)
    if input.Amount > balance {
        c.JSON(400, AppError{Message: "insufficient balance"})
        return
    }
    // 7-12: Same signing flow
    // 13: Update daily withdrawal tracker
    h.repo.IncrementDailyWithdrawal(user.ID, input.Asset, today(), input.Amount)
}
```

## Error Handling

```go
// Execution trace for debugging
ctx, trace := EnsureExecutionTrace(ctx, c.GetHeader("X-Trace-ID"))
trace.SetCurrentStep("sponsorship_decide")
// ... later ...
trace.SetCurrentStep("erc4337_execute")

// On failure, log full trace context
if err != nil {
    logger.Error("signing failed",
        "trace", trace,
        "user_id", user.ID,
        "contract", input.To,
        "selector", input.MethodSelector(),
        "error", err,
    )
}
```
