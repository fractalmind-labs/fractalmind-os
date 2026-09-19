# Factory Patterns

## Architecture Overview

The prediction market system uses a two-tier factory architecture:

```
FactoryRegistry (pointer to current factory)
  └─ DCPPFactory (binary markets)
       ├─ OptimisticController (clone) — market state machine
       ├─ BinaryCPMM (clone via BinaryCPMMFactory) — AMM
       └─ MultiOutcomeMarketFactory
            ├─ MultiOutcomeMarket (wrapper)
            └─ N × (OptimisticController + BinaryCPMM) — one-vs-rest
```

## EIP-1167 Minimal Proxy Clone

Each market deploys a clone (~45 bytes) pointing to a shared implementation. This reduces deployment cost from ~2M gas to ~60K gas per market.

```solidity
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";

// Clone + initialize pattern
address market = Clones.clone(optimisticImplementation);
OptimisticController(payable(market)).initialize(
    ctf, collateralToken, stakeToken, stakeAmount,
    treasury, msg.sender, question, metadata,
    livenessPeriod, outcomeSlots
);
```

Important: cloned contracts use `initialize()` instead of constructors. Guard with:
```solidity
bool private _initialized;
function initialize(...) external {
    if (_initialized) revert AlreadyInitialized();
    _initialized = true;
    // ...
}
```

## BinaryCPMMFactory — Avoiding EIP-170

The AMM factory is separated from the main factory to avoid the 24KB contract size limit:

```solidity
contract BinaryCPMMFactory {
    function deploy(
        address implementation,
        IConditionalTokens ctf,
        IERC20 collateralToken,
        bytes32 conditionId
    ) external returns (BinaryCPMM amm) {
        amm = BinaryCPMM(Clones.clone(implementation));
        amm.initialize(ctf, collateralToken, conditionId);
    }

    function bootstrap(
        address amm,
        uint256 amount,
        address lpRecipient,
        uint256 minLpOut
    ) external returns (uint256 lpOut) {
        // Transfer collateral to AMM, split into YES/NO, add liquidity
    }

    function applyInitialProbability(
        address amm,
        uint16 yesProbabilityBps,  // 1-9999
        address recipient,
        uint256 minSkewTokenOut
    ) external {
        // Skew AMM reserves to match desired probability
    }
}
```

## Multi-Outcome Markets

Multi-outcome markets decompose N options into N binary (one-vs-rest) markets:

```
"Who will win the election?"
  Option A (30%) → Binary market: "A wins?" YES/NO
  Option B (45%) → Binary market: "B wins?" YES/NO
  Option C (25%) → Binary market: "C wins?" YES/NO
```

Probabilities must sum to 10000 BPS (100%), with each in range [1, 9999]:

```solidity
function _validateInitialProbabilities(
    uint16[] memory probs,
    uint8 optionCount
) internal pure {
    if (probs.length != optionCount) revert InvalidProbabilitiesLength();
    uint256 sum = 0;
    for (uint256 i = 0; i < optionCount; i++) {
        if (probs[i] < MIN_INITIAL_PROBABILITY_BPS) revert InvalidInitialProbabilityBps();
        if (probs[i] > MAX_INITIAL_PROBABILITY_BPS) revert InvalidInitialProbabilityBps();
        sum += probs[i];
    }
    if (sum != 10000) revert ProbabilitiesMustSumTo10000();
}
```

## Market Deduplication

Optional `bytes32 key` prevents creating duplicate markets for the same event:

```solidity
mapping(bytes32 => address) public marketByKey;

function createOptimisticMarket_V4(..., bytes32 key) external returns (address market, address amm) {
    (market, amm) = createOptimisticMarket_V3(...);
    if (key != bytes32(0)) {
        if (marketByKey[key] != address(0)) revert MarketAlreadyExists();
        marketByKey[key] = market;
    }
}
```

Use case: when importing events from external sources (e.g., Polymarket), hash the external event ID as the key to prevent duplicate imports.

## Factory Versioning

Factories evolve through versioned creation methods (V1 → V5) rather than proxy upgrades:

| Version | Addition |
|---------|----------|
| V1 | Basic market creation |
| V2 | Oracle adapter support |
| V3 | Metadata + AMM return |
| V4 | Deduplication key |
| V5 | Initial probability skewing |

The registry pattern allows atomic factory upgrades:
```solidity
contract FactoryRegistry is Ownable {
    address public factory;
    function setFactory(address newFactory) external onlyOwner {
        factory = newFactory;
    }
}
```

## ReplayCarrier Pattern

For multi-outcome markets with many options, nested calls can run out of gas. The ReplayCarrier variant adds gas floor checks:

```solidity
uint256 private constant MIN_ADD_OPTION_PRECALL_GAS_FLOOR = 0x6299;

function _addOptionWithBoundary(...) private {
    if (gasleft() <= MIN_ADD_OPTION_PRECALL_GAS_FLOOR)
        revert AddOptionPreCallGasFloor();
    (bool ok,) = address(wrapper).call(
        abi.encodeCall(MultiOutcomeMarket.addOption, (...))
    );
    if (!ok) revert AddOptionCallFailed();
}
```

Key constants live in the ReplayCarrier contract and must match the main factory:
- `MIN_INITIAL_PROBABILITY_BPS` — minimum per-option probability (1 BPS = 0.01%)
- `MAX_INITIAL_PROBABILITY_BPS` — maximum per-option probability (9999 BPS)

**Production lesson**: When updating these constants, update BOTH the main factory AND the ReplayCarrier. Missing the ReplayCarrier caused a production deployment to ship with stale MIN=100 instead of MIN=1.
