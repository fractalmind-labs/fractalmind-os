# Gas Optimization on BSC/EVM

## Immutable Variables

Use `immutable` for dependencies set at construction time. Saves ~2100 gas per read (SLOAD → inline constant):

```solidity
IConditionalTokens public immutable ctf;
IERC20 public immutable collateralToken;
address public immutable optimisticImplementation;
uint256 public immutable stakeAmount;
address public immutable treasury;

// Only use mutable storage for governance-controlled values:
IYesNoOracleAdapter public oracleAdapter;  // Can be upgraded by owner
```

## Fee-on-Transfer Token Safety

BSC has many fee-on-transfer tokens. Never trust `transferFrom` return values — use balance snapshots:

```solidity
uint256 balBefore = collateralToken.balanceOf(address(this));
collateralToken.safeTransferFrom(msg.sender, address(this), requestedAmount);
uint256 received = collateralToken.balanceOf(address(this)) - balBefore;

// Use `received` (actual amount) not `requestedAmount` for all subsequent logic
if (received < minExpected) revert InsufficientReceived();
```

## Low-Level Transfer for Gas Savings

For hot-path token transfers, low-level calls save ~200 gas over SafeERC20:

```solidity
bytes4 private constant TRANSFER_FROM_SELECTOR = 0x23b872dd;

function _transferFrom(IERC20 token, address from, address to, uint256 amount) private {
    (bool success, bytes memory data) =
        address(token).call(abi.encodeWithSelector(TRANSFER_FROM_SELECTOR, from, to, amount));
    if (!success || (data.length != 0 && !abi.decode(data, (bool))))
        revert TransferFromFailed();
}
```

## Reentrancy Protection

Apply `ReentrancyGuard` to all functions that transfer tokens or interact with external contracts:

```solidity
contract BinaryCPMM is ERC20, ERC1155Holder, ReentrancyGuard {
    function addLiquidity(uint256 amount) external nonReentrant returns (uint256 lpOut) {
        // Check
        require(amount > 0);
        // Effect
        uint256 received = _safeTransferIn(amount);
        lpOut = _computeLpTokens(received);
        _mint(msg.sender, lpOut);
        // Interaction (already done in _safeTransferIn)
    }

    function removeLiquidity(uint256 lpAmount) external nonReentrant {
        // Check
        require(lpAmount > 0);
        // Effect
        _burn(msg.sender, lpAmount);
        (uint256 collateralOut, uint256 yesOut, uint256 noOut) = _computeWithdrawal(lpAmount);
        // Interaction
        collateralToken.safeTransfer(msg.sender, collateralOut);
        ctf.safeTransferFrom(address(this), msg.sender, yesTokenId, yesOut, "");
        ctf.safeTransferFrom(address(this), msg.sender, noTokenId, noOut, "");
    }
}
```

## Gas Floor Check for Batch Operations

When creating multi-outcome markets, the factory calls `addOption()` N times in a loop. Deep in the call stack, gas can run out silently. Add an explicit gas floor check:

```solidity
uint256 private constant MIN_ADD_OPTION_PRECALL_GAS_FLOOR = 0x6299;  // ~25K gas

function _addOptionWithBoundary(
    MultiOutcomeMarket wrapper,
    address market,
    address amm,
    uint256 yesTokenId,
    uint256 noTokenId
) private {
    // Check remaining gas before making the call
    if (gasleft() <= MIN_ADD_OPTION_PRECALL_GAS_FLOOR)
        revert AddOptionPreCallGasFloor();

    (bool ok,) = address(wrapper).call(
        abi.encodeCall(MultiOutcomeMarket.addOption, (market, amm, yesTokenId, noTokenId))
    );
    if (!ok) revert AddOptionCallFailed();
}
```

This prevents the entire transaction from reverting with an unhelpful out-of-gas error. Instead, it gives a clear `AddOptionPreCallGasFloor` error that indicates the block gas limit was insufficient for the number of options.

## EIP-1167 Clone vs Full Deploy

| Approach | Gas Cost | Bytecode Size | Use When |
|----------|----------|---------------|----------|
| Full deploy | ~2M gas | Full contract | One-off singletons |
| EIP-1167 clone | ~60K gas | 45 bytes | Many instances (markets) |
| CREATE2 | ~2M + salt | Full contract | Deterministic addresses needed |

Prediction markets use clones because:
- Each market is a separate instance with different state
- Thousands of markets may exist
- Clone cost is ~30x cheaper

## Optimizer Settings

```toml
optimizer = true
optimizer_runs = 200  # Balance deploy cost vs runtime cost
```

For factory contracts deployed once: `optimizer_runs = 200` is fine.
For implementation contracts (cloned many times): the implementation is deployed once, clones delegate calls to it. Optimize the implementation for runtime (`optimizer_runs = 1000+`).

## BSC-Specific Notes

- BSC block gas limit: 140M gas (much higher than Ethereum's ~30M)
- BSC gas price: typically 1-5 gwei, with BNB at ~$600
- Transaction cost for market creation: ~$0.50-$2.00
- Multi-outcome market with 10 options: ~$5-$10 total
- Sponsored transactions via ERC-4337 or BEP-414 can cover user gas costs
