# Oracle Patterns

## Oracle Adapter Interface

The adapter pattern decouples market logic from oracle implementation:

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

## External Oracle Adapter

Simplest production pattern — a trusted address resolves outcomes:

```solidity
contract ExternalMultiOutcomeOracleAdapter is IMultiOutcomeOracleAdapter {
    address public immutable answerProvider;
    uint256 private _nextQuestionNonce;

    function ask(...) external payable returns (bytes32 qid) {
        // Validate option labels
        string[] memory labels = abi.decode(encodedOptionLabels, (string[]));
        require(labels.length >= 2);

        // Generate unique question ID
        qid = keccak256(abi.encode(
            question, encodedOptionLabels, deadline, data,
            msg.sender, block.chainid, address(this), _nextQuestionNonce++
        ));

        // Store question state
        _questions[qid] = Question({
            requester: msg.sender,
            value: msg.value,
            deadline: deadline,
            optionCount: uint8(labels.length),
            finalized: false,
            winnerIndex: 0,
            refunded: false
        });
    }

    function finalizeAnswer(bytes32 qid, uint8 winnerIndex) external {
        require(msg.sender == answerProvider);
        Question storage q = _questions[qid];
        require(!q.finalized);
        require(winnerIndex < q.optionCount);
        q.finalized = true;
        q.winnerIndex = winnerIndex;
    }
}
```

## Bounty Oracle (SoraOracle)

Provider earns bounty for answering questions after deadline:

```solidity
contract SoraOracle is Ownable, ReentrancyGuard {
    struct Question {
        address requester;
        uint88 bounty;
        uint32 deadline;
        AnswerStatus status;  // PENDING → ANSWERED
    }

    function askYesNoQuestion(string calldata question, uint256 deadline)
        external payable returns (uint256 questionId)
    {
        require(msg.value >= oracleFee);
        require(deadline > block.timestamp);
        // Store question with bounty = msg.value
    }

    function provideAnswer(uint256 qid, bool answer, uint8 confidence, string calldata source)
        external onlyOracleProvider
    {
        require(block.timestamp >= questions[qid].deadline);
        // Mark answered, add bounty to providerBalance
    }

    function refund(uint256 qid) external {
        require(!questions[qid].finalized);
        require(block.timestamp >= questions[qid].deadline + REFUND_GRACE);
        // Return bounty to requester
    }
}
```

## Settlement Coordinator (MultiOutcomeMarket)

The wrapper coordinates the oracle lifecycle for multi-option markets:

```
Phase 1: Request
  market.requestWinnerFromOracle(deadline, data) {value: fee}
    → oracleAdapter.ask(question, labels, deadline, data)
    → stores oracleQuestionId

Phase 2: Propose (after oracle answers)
  market.proposeWinnerFromOracle(data)
    → oracleAdapter.getAnswer(qid) → (true, winnerIndex)
    → _proposeWinner(winnerIndex)
    → starts liveness period

Phase 3: Settle (after liveness period)
  market.settleWinnerFromOracle()
    → oracleAdapter.getAnswer(qid) → verify still finalized
    → _settleWinner(winnerIndex)
    → ctf.reportPayouts() for winner + all losers

Phase 4 (alternative): Refund (if oracle never answers)
  market.refundOracleQuestion()
    → require(!finalized && block.timestamp > deadline)
    → oracleAdapter.refund(qid)
    → return bounty to original requester
```

## oracleAskAfter Gate

Some markets gate when the oracle can be asked (e.g., after an event date):

```solidity
uint256 public oracleAskAfter;

function requestWinnerFromOracle(uint256 deadline, bytes calldata data) external payable {
    if (oracleAskAfter != 0 && block.timestamp < oracleAskAfter)
        revert OracleAskTooEarly();
    // ...
}
```

## Design Considerations

1. **Immutable oracle adapter** — set at construction, not upgradeable per-market. Change adapter by deploying new factory.
2. **Bounty model** — oracle providers are economically incentivized to answer. Fee set by oracle owner.
3. **Deadline enforcement** — providers can only answer AFTER deadline, preventing premature resolution.
4. **Refund path** — if oracle never answers, requester can reclaim bounty after grace period.
5. **Question ID uniqueness** — includes chainId + adapter address + nonce to prevent cross-chain/cross-adapter collisions.
