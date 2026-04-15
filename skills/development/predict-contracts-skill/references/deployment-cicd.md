# Deployment & CI/CD

## Forge Script Pattern

Deployment scripts use environment variables for configuration with mainnet guardrails:

```solidity
contract Deploy is Script {
    function run() external {
        // Key derivation: mnemonic or raw private key
        uint256 pk;
        string memory mnemonic = vm.envOr("MNEMONIC", string(""));
        if (bytes(mnemonic).length > 0) {
            pk = vm.deriveKey(mnemonic, 0);
        } else {
            pk = vm.envUint("PRIVATE_KEY");
        }

        // Load dependency addresses (deploy mocks if missing)
        address ctfAddr = vm.envOr("CTF_ADDRESS", address(0));
        address collateralAddr = vm.envOr("COLLATERAL_ADDRESS", address(0));
        address treasury = vm.envOr("TREASURY_ADDRESS", vm.addr(pk));

        // Mainnet guardrails — prevent deploying with test defaults
        if (block.chainid == 56) {
            require(ctfAddr != address(0), "CTF_ADDRESS required on mainnet");
            require(treasury != vm.addr(pk), "TREASURY_ADDRESS required on mainnet");
        }

        vm.startBroadcast(pk);
        // Deploy contracts...
        vm.stopBroadcast();
    }
}
```

### Dry Run vs Broadcast

```bash
# Dry run (simulation only)
forge script script/Deploy.s.sol --rpc-url $RPC_URL

# Broadcast (actually deploy)
forge script script/Deploy.s.sol --rpc-url $RPC_URL --broadcast

# With verification
forge script script/Deploy.s.sol --rpc-url $RPC_URL --broadcast --verify
```

## Factory Upgrade via Registry

Deploy a new factory instance and update the registry pointer:

```solidity
contract UpgradeFactory is Script {
    function run() external {
        address registryAddr = vm.envAddress("REGISTRY_ADDRESS");
        FactoryRegistry registry = FactoryRegistry(registryAddr);

        vm.startBroadcast(pk);
        DCPPFactory newFactory = new DCPPFactory(ctf, collateral, ...);
        registry.setFactory(address(newFactory));
        vm.stopBroadcast();

        // Verify
        require(registry.factory() == address(newFactory));
    }
}
```

## CI/CD Workflow

### The Foundry Cache Bug

**Problem**: `foundry-rs/foundry-toolchain@v1` caches compiled artifacts in GitHub Actions. If `solidity-files-cache.json` was committed to git, or if the CI cache contains old artifacts, `forge build` may skip recompilation and deploy **stale bytecode** — even when source code has changed.

**Real incident**: PR changed `MIN_INITIAL_PROBABILITY_BPS` from 100 to 1 in source, but deployed bytecode still contained `PUSH1 0x64` (100) instead of `PUSH1 0x01` (1). Root cause: CI cached the old compilation output.

**Fix (three layers)**:

1. **Disable CI artifact cache**:
```yaml
- uses: foundry-rs/foundry-toolchain@v1
  with:
    version: nightly
    cache: false  # Critical: prevent stale artifacts
```

2. **Exclude Foundry cache from git**:
```gitignore
# .gitignore in contracts directory
cache/
```

3. **Always clean before deploy** (Makefile):
```makefile
deploy: clean build
	forge script $(SCRIPT) --rpc-url $(RPC_URL) --broadcast ...

deploy-dry: clean build
	forge script $(SCRIPT) --rpc-url $(RPC_URL)

clean:
	forge clean

build:
	forge build
```

### Bytecode Verification

After deployment, verify the deployed bytecode contains expected constants:

```bash
# Check deployed bytecode for MIN=1 (PUSH1 0x01 near error selector)
cast code $CONTRACT_ADDRESS --rpc-url $RPC_URL | grep -c "6001"

# Verify no stale MIN=100 (PUSH1 0x64)
cast code $CONTRACT_ADDRESS --rpc-url $RPC_URL | grep -c "6064"
```

### Workflow Structure

```yaml
name: Upgrade Predict Contracts
on:
  workflow_dispatch:
    inputs:
      deployment_env:
        type: choice
        options: [test, live]
      script:
        description: "Forge script to run"
        default: "script/UpgradeFactory.s.sol"

jobs:
  upgrade:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: foundry-rs/foundry-toolchain@v1
        with:
          cache: false

      - name: Deploy
        working-directory: contracts/predict
        env:
          PRIVATE_KEY: ${{ secrets.DEPLOYER_PRIVATE_KEY }}
          RPC_URL: ${{ secrets.BSC_RPC_URL }}
          CTF_ADDRESS: ${{ vars.CTF_ADDRESS }}
          # ... other env vars from secrets/vars
        run: make deploy SCRIPT=${{ inputs.script }}
```

## Post-Deploy Wiring

After deploying new contracts, additional configuration may be required:

### Oracle Adapter Configuration
```bash
# Set oracle adapter on multi-outcome factory
cast send $FACTORY "setOracleAdapter(address)" $ADAPTER --private-key $PK --rpc-url $RPC

# Grant BOOTSTRAPPER_ROLE on CTF policy
cast send $CTF_POLICY "grantRole(bytes32,address)" $ROLE_HASH $NEW_FACTORY --private-key $PK --rpc-url $RPC
```

### Access Control Setup

**Production lesson**: `forge script` with `vm.writeFile()` reverts the ENTIRE script (including broadcast transactions) if the target directory doesn't exist. Always `mkdir -p` before running scripts that write artifacts:

```yaml
- name: Apply CTF policy
  run: |
    mkdir -p contracts/predict/artifacts/owned-ctf-policy/
    cd contracts/predict
    forge script script/ApplyOwnedCTFPolicy.s.sol --rpc-url $RPC --broadcast
```

## foundry.toml Configuration

```toml
[profile.default]
src = "src"
out = "out"
libs = ["lib"]
solc_version = "0.8.19"
optimizer = true
optimizer_runs = 200

# Required for scripts that read/write config files
fs_permissions = [
  { access = "read", path = "config/" },
  { access = "read-write", path = "artifacts/" },
]

[rpc_endpoints]
bsc_mainnet = "${BSC_MAINNET_RPC_URL}"
bsc_testnet = "${BSC_TESTNET_RPC_URL}"
```

## Deployment Checklist

1. Ensure `cache: false` in foundry-toolchain action
2. Run `forge clean && forge build` locally to verify correct bytecode
3. Dry-run the script first (`make deploy-dry`)
4. Verify mainnet guardrails are active (`block.chainid == 56` checks)
5. After deploy: verify bytecode on-chain matches expected constants
6. Run post-deploy wiring (oracle adapter, access control)
7. Update environment variables/secrets for subsequent workflows
