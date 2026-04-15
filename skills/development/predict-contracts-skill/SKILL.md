---
name: predict-contracts
description: Prediction market smart contract development on BSC/EVM using Foundry. Covers factory patterns (EIP-1167 clones), Gnosis Conditional Token Framework (CTF) integration, oracle adapter design, multi-outcome market architecture, deployment scripts (forge script), CI/CD cache pitfalls, and gas optimization. Use when building prediction market contracts, deploying market factories, integrating CTF for outcome token management, designing oracle settlement flows, or debugging Foundry CI cache issues.
---

# Prediction Market Contract Development

Build production prediction market infrastructure on BSC/EVM with Foundry.

## Quick Start

```solidity
// Factory creates binary markets via EIP-1167 minimal proxy clones
contract DCPPFactory is Ownable {
    function createOptimisticMarket_V3(
        string calldata question,
        string calldata metadata,
        uint256 livenessPeriod,
        uint8 outcomeSlots,
        uint256 initialLiquidityAmount,
        uint256 minInitialLiquidityReceived,
        uint256 minLpOut
    ) public returns (address market, address amm) {
        market = Clones.clone(optimisticImplementation);
        // Initialize controller, deploy AMM, bootstrap liquidity
    }
}
```

## Core Capabilities

### 1. Factory Pattern with EIP-1167 Clones

Deploy markets cheaply (~60K gas) using minimal proxy clones instead of full contract deployments.

**Binary Market Factory** creates an OptimisticController clone + BinaryCPMM AMM:
```solidity
// Clone controller
market = Clones.clone(optimisticImplementation);
OptimisticController(payable(market)).initialize(ctf, collateralToken, ...);

// Deploy AMM via separate factory (avoids EIP-170 size limit)
BinaryCPMM pool = ammFactory.deploy(conditionId);
amm = address(pool);

// Bootstrap with initial liquidity
ammFactory.bootstrap(amm, received, msg.sender, minLpOut);
```

**Multi-Outcome Market Factory** creates N binary markets (one-vs-rest) for multi-option outcomes:
```solidity
function createOptimisticMultiOutcomeMarket_V2(
    string memory question,
    bytes memory encodedOptionLabels,
    uint16[] memory initialYesProbabilitiesBps,  // Per-option: 1-9999 BPS
    ...
) external returns (address multiMarket) {
    _validateInitialProbabilities(initialYesProbabilitiesBps, ...);
    MultiOutcomeMarket wrapper = new MultiOutcomeMarket(...);
    _bootstrapOptions(wrapper, livenessPeriod, ...);  // Creates N binary markets
}
```

**Market Deduplication** — optional bytes32 key prevents duplicate creation:
```solidity
mapping(bytes32 => address) public marketByKey;
if (params.key != bytes32(0)) {
    if (marketByKey[params.key] != address(0)) revert MarketAlreadyExists();
    marketByKey[params.key] = multiMarket;
}
```

See `references/factory-patterns.md` for full factory architecture.

### 2. Gnosis CTF Integration

Manage outcome tokens via the Conditional Token Framework (ERC-1155):

```solidity
library BinaryMarketLib {
    uint256 internal constant YES_INDEX_SET = 1;
    uint256 internal constant NO_INDEX_SET = 2;

    function prepareBinaryCondition(IConditionalTokens ctf, address oracle, bytes32 questionId)
        internal returns (bytes32 conditionId)
    {
        ctf.prepareCondition(oracle, questionId, 2);
        return ctf.getConditionId(oracle, questionId, 2);
    }

    function splitBinary(IConditionalTokens ctf, IERC20 collateral, bytes32 conditionId, uint256 amount)
        internal
    {
        uint256[] memory partition = new uint256[](2);
        partition[0] = YES_INDEX_SET;
        partition[1] = NO_INDEX_SET;
        ctf.splitPosition(collateral, bytes32(0), conditionId, partition, amount);
    }

    function reportBinaryPayouts(IConditionalTokens ctf, bytes32 questionId, uint8 winner) internal {
        uint256[] memory payouts = new uint256[](2);
        payouts[winner] = 1;
        ctf.reportPayouts(questionId, payouts);
    }
}
```

**Key CTF Operations:**
- `prepareCondition` — register a new question with N outcomes
- `splitPosition` — lock collateral, receive outcome tokens (YES/NO)
- `mergePositions` — burn outcome tokens, recover collateral
- `reportPayouts` — oracle reports winning outcome
- `redeemPositions` — winners burn tokens for collateral payout

See `references/ctf-integration.md` for position ID derivation and multi-outcome CTF flows.

### 3. Oracle Adapter Design

Pluggable oracle interface separates market logic from resolution:

```solidity
interface IMultiOutcomeOracleAdapter {
    function ask(
        string calldata question,
        bytes calldata encodedOptionLabels,
        uint256 deadline,
        bytes calldata data
    ) external payable returns (bytes32 oracleQuestionId);

    function getAnswer(bytes32 oracleQuestionId)
        external view returns (bool finalized, uint8 winnerIndex);

    function refund(bytes32 oracleQuestionId)
        external returns (uint256 refunded);
}
```

**External Oracle Adapter** — simplest production pattern, external provider decides outcome:
```solidity
contract ExternalMultiOutcomeOracleAdapter is IMultiOutcomeOracleAdapter {
    address public immutable answerProvider;

    function finalizeAnswer(bytes32 qid, uint8 winnerIndex) external {
        if (msg.sender != answerProvider) revert UnauthorizedAnswerProvider();
        // Mark finalized, store winner
    }
}
```

**Bounty Oracle** (SoraOracle) — provider earns bounty for answering after deadline:
```solidity
contract SoraOracle {
    function askYesNoQuestion(string calldata question, uint256 deadline)
        external payable returns (uint256 questionId);

    function provideAnswer(uint256 qid, bool answer, uint8 confidence, string calldata source)
        external onlyOracleProvider;
    // Provider collects bounty after answering
}
```

**Settlement Coordinator** on MultiOutcomeMarket:
```
requestWinnerFromOracle() → oracle.ask()
   ↓ (wait for deadline + provider answer)
proposeWinnerFromOracle() → oracle.getAnswer() → _proposeWinner()
   ↓ (wait for liveness period)
settleWinnerFromOracle() → oracle.getAnswer() → _settleWinner() → ctf.reportPayouts()
```

See `references/oracle-patterns.md` for full oracle lifecycle.

### 4. Deployment & CI/CD

**Forge Script Pattern** — environment-driven deployment with mainnet guardrails:
```solidity
contract Deploy is Script {
    function run() external {
        uint256 pk = vm.envOr("MNEMONIC", string("")).length > 0
            ? vm.deriveKey(vm.envString("MNEMONIC"), 0)
            : vm.envUint("PRIVATE_KEY");

        // Mainnet guardrails
        if (block.chainid == 56 && ctfAddr == address(0))
            revert("CTF_ADDRESS required on BSC mainnet");

        vm.startBroadcast(pk);
        // Deploy contracts...
        vm.stopBroadcast();
    }
}
```

**Factory Upgrade via Registry** — deploy new factory, update registry pointer:
```solidity
DCPPFactory newFactory = new DCPPFactory(ctf, collateral, ...);
registry.setFactory(address(newFactory));  // Atomic pointer swap
```

**CI/CD Cache Bug** — critical production lesson:
```yaml
# foundry-toolchain@v1 caches compiled artifacts in GitHub Actions.
# If solidity-files-cache.json is committed to git, forge may skip
# recompilation even when source code changes, deploying STALE bytecode.
#
# Fix:
- uses: foundry-rs/foundry-toolchain@v1
  with:
    cache: false  # Disable CI artifact caching

# Also: .gitignore the Foundry cache directory
# cache/

# Makefile: always clean before deploy
deploy: clean build
	forge script $(SCRIPT) --rpc-url $(RPC_URL) --broadcast ...
```

**Foundry Configuration** (foundry.toml):
```toml
[profile.default]
solc_version = "0.8.19"
optimizer = true
optimizer_runs = 200

# File permissions for on-chain config bundles
fs_permissions = [
  { access = "read", path = "config/" },
  { access = "read-write", path = "artifacts/" },
]
```

See `references/deployment-cicd.md` for full workflow patterns.

### 5. Gas Optimization on BSC

**Immutable Dependencies** — SLOAD-free access for frequently used addresses:
```solidity
IConditionalTokens public immutable ctf;          // Set once at construction
IERC20 public immutable collateralToken;           // Never changes
address public immutable optimisticImplementation; // Clone template
// Mutable state only for governance (rare access):
IYesNoOracleAdapter public oracleAdapter;
```

**Fee-on-Transfer Safe Token Handling**:
```solidity
uint256 balBefore = collateralToken.balanceOf(address(this));
collateralToken.safeTransferFrom(msg.sender, address(this), amount);
uint256 received = collateralToken.balanceOf(address(this)) - balBefore;
```

**Gas Floor Check** for batch operations:
```solidity
uint256 private constant MIN_PRECALL_GAS_FLOOR = 0x6299;  // ~25K

function _addOptionWithBoundary(...) private {
    if (gasleft() <= MIN_PRECALL_GAS_FLOOR) revert AddOptionPreCallGasFloor();
    (bool ok,) = address(wrapper).call(abi.encodeCall(...));
    if (!ok) revert AddOptionCallFailed();
}
```

**ReentrancyGuard + Check-Effects-Interactions**:
```solidity
contract BinaryCPMM is ERC20, ERC1155Holder, ReentrancyGuard {
    function addLiquidity(uint256 amount) external nonReentrant returns (uint256 lpOut) {
        // Check: validate input
        // Effect: compute LP tokens
        // Interaction: transfer tokens
        uint256 received = _safeTransferIn(amount);
        lpOut = _addLiquidityFromBalance(received, msg.sender);
    }
}
```

See `references/gas-optimization.md` for BSC-specific patterns.

## Testing Patterns

**E2E Test with Oracle Settlement**:
```solidity
function test_FullFlow_CreateTradeOracleSettleRedeem() public {
    // 1. Deploy oracle + factory
    factory = new DCPPFactory(ctf, usdc, ...);

    // 2. Create market with initial liquidity
    vm.startPrank(creator);
    usdc.approve(address(factory), STAKE + liquidity);
    (market, amm) = factory.createOptimisticMarket_V3(...);
    vm.stopPrank();

    // 3. Trade: buy YES tokens via AMM
    vm.startPrank(trader);
    usdc.approve(address(amm), tradeAmount);
    amm.swapCollateralForOutcome(yesTokenId, tradeAmount, 0);
    vm.stopPrank();

    // 4. Oracle question + answer
    market.requestOracleQuestion{value: 1}("e2e");
    vm.warp(deadline);
    vm.prank(oracleProvider);
    soraOracle.provideAnswer(qid, true, 100, "test");

    // 5. Propose + settle after liveness
    market.proposeOutcomeFromOracle("oracle-finalized");
    vm.warp(block.timestamp + LIVENESS);
    market.settle("");
    assertEq(market.resolvedOutcome(), 0);  // YES won

    // 6. Redeem
    vm.startPrank(trader);
    BinaryMarketLib.redeemYes(ctf, usdc, market.conditionId());
    assertEq(ctf.balanceOf(trader, yesTokenId), 0);
    vm.stopPrank();
}
```

## Decision Framework

| Scenario | Pattern | Reference |
|----------|---------|-----------|
| New binary market type | Clone OptimisticController via DCPPFactory | `references/factory-patterns.md` |
| Multi-outcome market (3+ options) | MultiOutcomeMarketFactory (N one-vs-rest) | `references/factory-patterns.md` |
| Custom oracle integration | Implement IMultiOutcomeOracleAdapter | `references/oracle-patterns.md` |
| AMM with initial probability | V5 factory method with BPS skewing | `references/factory-patterns.md` |
| Factory upgrade | Deploy new factory + registry pointer swap | `references/deployment-cicd.md` |
| CI deploys stale bytecode | Disable foundry-toolchain cache + forge clean | `references/deployment-cicd.md` |
| BSC fee-on-transfer tokens | Balance snapshot pattern | `references/gas-optimization.md` |
| Batch operation gas safety | Gas floor check before nested calls | `references/gas-optimization.md` |

## Resources

- `references/factory-patterns.md` — Factory architecture, clone patterns, market deduplication
- `references/ctf-integration.md` — CTF position lifecycle, split/merge/redeem flows
- `references/oracle-patterns.md` — Oracle adapter design, settlement coordinator, bounty model
- `references/deployment-cicd.md` — Forge scripts, CI cache fix, upgrade workflows, Makefile
- `references/gas-optimization.md` — BSC-specific gas patterns, reentrancy, immutables
