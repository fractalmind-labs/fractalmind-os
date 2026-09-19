# CTF (Conditional Token Framework) Integration

## Overview

The Gnosis Conditional Token Framework is an ERC-1155 contract that manages outcome tokens for prediction markets. Collateral (e.g., USDC) is locked to mint outcome tokens; winning tokens are redeemed for collateral after settlement.

## Position ID Derivation

```
conditionId = keccak256(oracle, questionId, outcomeSlotCount)
collectionId = keccak256(parentCollectionId, conditionId, indexSet)
positionId = keccak256(collateralToken, collectionId)
```

For binary markets:
- YES token: `indexSet = 1` (bit 0)
- NO token: `indexSet = 2` (bit 1)

```solidity
function getBinaryPositionIds(
    IConditionalTokens ctf,
    IERC20 collateralToken,
    bytes32 conditionId
) internal view returns (uint256 yesTokenId, uint256 noTokenId) {
    bytes32 yesCollection = ctf.getCollectionId(bytes32(0), conditionId, 1);
    bytes32 noCollection = ctf.getCollectionId(bytes32(0), conditionId, 2);
    yesTokenId = ctf.getPositionId(collateralToken, yesCollection);
    noTokenId = ctf.getPositionId(collateralToken, noCollection);
}
```

## Core Operations

### Split: Collateral → Outcome Tokens

```solidity
// Lock 100 USDC → receive 100 YES + 100 NO tokens
uint256[] memory partition = new uint256[](2);
partition[0] = 1;  // YES
partition[1] = 2;  // NO
ctf.splitPosition(collateralToken, bytes32(0), conditionId, partition, 100e6);
```

### Merge: Outcome Tokens → Collateral

```solidity
// Burn 50 YES + 50 NO → recover 50 USDC
ctf.mergePositions(collateralToken, bytes32(0), conditionId, partition, 50e6);
```

### Report Payouts: Oracle Settlement

```solidity
// YES wins: payouts = [1, 0]
uint256[] memory payouts = new uint256[](2);
payouts[0] = 1;  // YES wins
payouts[1] = 0;  // NO loses
ctf.reportPayouts(questionId, payouts);
```

### Redeem: Winners Claim Collateral

```solidity
// Winner redeems YES tokens for USDC
uint256[] memory indexSets = new uint256[](1);
indexSets[0] = 1;  // YES index set
ctf.redeemPositions(collateralToken, bytes32(0), conditionId, indexSets);
```

## Multi-Outcome CTF Flow

For N-option markets, each option gets its own binary condition:

```
Event: "Who wins?" (A, B, C)
  ├─ Condition_A: oracle=wrapper, questionId=hash("A"), slots=2
  │   ├─ YES_A token (option A wins)
  │   └─ NO_A token (option A loses)
  ├─ Condition_B: oracle=wrapper, questionId=hash("B"), slots=2
  │   ├─ YES_B token
  │   └─ NO_B token
  └─ Condition_C: oracle=wrapper, questionId=hash("C"), slots=2
      ├─ YES_C token
      └─ NO_C token
```

Settlement: wrapper reports `[1,0]` for winning option, `[0,1]` for all losers.

## Bootstrap Registration

Optimization for custom CTF deployments that support controller preregistration:

```solidity
bytes32 private constant BOOTSTRAP_MODE = keccak256("CLOUDBANK_CTF_BOOTSTRAP_V1");

function _preregisterControllerIfSupported(address controller) private {
    (bool ok, bytes memory data) = address(ctf).staticcall(
        abi.encodeCall(IConditionalTokensBootstrap.bootstrapRegistrationMode, ())
    );
    if (ok && data.length == 32 && abi.decode(data, (bytes32)) == BOOTSTRAP_MODE) {
        IConditionalTokensBootstrap(address(ctf)).preregisterController(controller);
    }
}
```

This avoids expensive storage operations in the CTF contract when creating markets.

## AMM Integration

The BinaryCPMM uses CTF tokens as its reserves:

```
User wants to buy YES:
  1. User sends USDC to AMM
  2. AMM splits USDC → YES + NO via CTF
  3. AMM keeps NO tokens (increases NO reserve)
  4. AMM sends YES tokens to user (from split + existing YES reserve)
  5. Price shifts based on constant product formula
```

Liquidity providers hold LP tokens backed by both YES and NO reserves:
```
addLiquidity(100 USDC):
  1. Split 100 USDC → 100 YES + 100 NO
  2. Add both to reserves proportionally
  3. Mint LP tokens to provider
```
