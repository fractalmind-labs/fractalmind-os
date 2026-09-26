---
name: web3-wallet-mock-skill
description: Mock browser wallets (MetaMask, WalletConnect, etc.) for AI Agent E2E testing. Use when building automated tests that need to simulate wallet connect, transaction signing, network switching, and token approvals without a real browser extension.
---

# web3-wallet-mock-skill

## When to use

Use this skill when you need to:
- mock MetaMask or other injected wallets (`window.ethereum`) in Playwright/Puppeteer E2E tests
- simulate WalletConnect sessions for dApp testing without a real mobile wallet
- automate wallet interactions (connect, sign, approve, switch network) in CI pipelines
- build AI agent workflows that test dApp frontends end-to-end
- validate dApp behavior across different wallet states (connected, disconnected, wrong network, insufficient funds)

## Web3 wallet mock strategies

### Strategy 1: Provider injection (recommended for most cases)

Inject a mock EIP-1193 provider into `window.ethereum` before the dApp loads. This gives full control over every RPC call the dApp makes.

```typescript
// Playwright example: inject mock provider before page loads
await page.addInitScript(() => {
  const accounts = ['0xYourTestAddress'];
  const chainId = '0x1'; // mainnet

  window.ethereum = {
    isMetaMask: true,
    selectedAddress: accounts[0],
    chainId,
    networkVersion: '1',
    isConnected: () => true,

    request: async ({ method, params }) => {
      switch (method) {
        case 'eth_requestAccounts':
        case 'eth_accounts':
          return accounts;
        case 'eth_chainId':
          return chainId;
        case 'net_version':
          return '1';
        case 'personal_sign':
          return mockSign(params[0], params[1]);
        case 'eth_sendTransaction':
          return mockSendTransaction(params[0]);
        case 'wallet_switchEthereumChain':
          return null; // success
        case 'eth_estimateGas':
          return '0x5208'; // 21000
        case 'eth_getBalance':
          return '0xDE0B6B3A7640000'; // 1 ETH
        default:
          throw { code: 4200, message: `Unsupported method: ${method}` };
      }
    },

    on: (event, cb) => { /* store listeners */ },
    removeListener: (event, cb) => { /* cleanup */ },
  };
});
```

### Strategy 2: Browser extension mock

For dApps that detect wallet extensions by checking for specific DOM markers or extension IDs:

```typescript
// Mock the extension detection
await page.addInitScript(() => {
  // Simulate MetaMask extension being installed
  Object.defineProperty(navigator, 'plugins', {
    get: () => [{ name: 'MetaMask', filename: 'nkbihfbeogaeaoehlefnkodbefgpgknn' }],
  });
});
```

### Strategy 3: WalletConnect mock

For dApps that use WalletConnect, intercept the WebSocket connection:

```typescript
// Intercept WalletConnect relay
await page.route('**/wss://relay.walletconnect.com/**', route => {
  // Return mock session approval
  route.fulfill({ body: mockWCSession });
});
```

## Core mock capabilities

### 1. Account management

```typescript
interface WalletMock {
  // Set available accounts
  setAccounts(accounts: string[]): void;

  // Simulate account change (fires 'accountsChanged' event)
  switchAccount(address: string): void;

  // Simulate disconnect
  disconnect(): void;

  // Simulate locked wallet (no accounts available)
  lock(): void;
}
```

### 2. Transaction signing

```typescript
// Default: auto-approve and return a local mock tx hash. Nothing is broadcast.
function mockSendTransaction(tx: EthTransaction): string {
  const txHash = '0x' + randomBytes(32).toString('hex');
  // Store for later verification
  sentTransactions.push({ ...tx, hash: txHash });
  return txHash;
}

// Broadcast mode: sign with the configured test key and send to rpcUrl.
// The key stays in the Playwright process. Do not put it in page JavaScript.
// Chain 1 and chain 999 are refused unless allowMainnet is true.
async function broadcastSendTransaction(tx: EthTransaction, config: BroadcastConfig): Promise<string> {
  const chainId = parseInt(config.chainId, 16);
  if (!config.allowMainnet && (chainId === 1 || chainId === 999)) {
    throw new Error('broadcast refuses Ethereum mainnet and HyperEVM mainnet');
  }
  const provider = new ethers.JsonRpcProvider(config.rpcUrl, chainId);
  const wallet = new ethers.Wallet(config.privateKey, provider);
  const sent = await wallet.sendTransaction({
    to: tx.to,
    data: tx.data,
    value: tx.value ? BigInt(tx.value) : undefined,
  });
  sentTransactions.push({ ...tx, hash: sent.hash, broadcast: true });
  return sent.hash;
}

// For personal_sign / eth_sign / signTypedData
function mockSign(data: string, address: string): string {
  // Use a local private key to produce a valid signature
  const wallet = new ethers.Wallet(TEST_PRIVATE_KEY);
  return wallet.signMessage(ethers.getBytes(data));
}
```

### 3. Network switching

```typescript
function handleSwitchChain(chainId: string): void {
  const supported = ['0x1', '0x89', '0x38', '0xa']; // ETH, Polygon, BSC, Optimism

  if (!supported.includes(chainId)) {
    throw { code: 4902, message: 'Unrecognized chain ID' };
  }

  currentChainId = chainId;
  // Fire chainChanged event
  listeners['chainChanged']?.forEach(cb => cb(chainId));
}
```

### 4. Error simulation

```typescript
// Simulate common wallet errors for negative testing
const walletErrors = {
  userRejected:    { code: 4001, message: 'User rejected the request' },
  unauthorized:    { code: 4100, message: 'The requested account is not authorized' },
  unsupported:     { code: 4200, message: 'The requested method is not supported' },
  disconnected:    { code: 4900, message: 'The provider is disconnected' },
  chainDisconnect: { code: 4901, message: 'The provider is not connected to the requested chain' },
};

// Example: simulate user clicking "Reject" on tx confirmation
mock.setNextResponse('eth_sendTransaction', () => {
  throw walletErrors.userRejected;
});
```

## Playwright integration patterns

### Basic setup

```typescript
import { test, expect, Page } from '@playwright/test';

async function setupWalletMock(page: Page, config: WalletConfig) {
  await page.addInitScript((cfg) => {
    // Inject full EIP-1193 provider (see Strategy 1 above)
    window.ethereum = createMockProvider(cfg);
  }, config);
}

test('user can connect wallet and approve token', async ({ page }) => {
  await setupWalletMock(page, {
    accounts: ['0xTestAddr'],
    chainId: '0x1',
    balance: '1000000000000000000', // 1 ETH
  });

  await page.goto('https://app.example.com');
  await page.click('[data-testid="connect-wallet"]');

  // Wallet auto-connects via mock
  await expect(page.locator('[data-testid="wallet-address"]'))
    .toContainText('0xTest');

  // Click approve - mock auto-signs
  await page.click('[data-testid="approve-btn"]');
  await expect(page.locator('[data-testid="tx-status"]'))
    .toContainText('Confirmed');
});
```

### Testing wallet disconnect

```typescript
test('app handles wallet disconnect gracefully', async ({ page }) => {
  const mock = await setupWalletMock(page, { accounts: ['0xAddr'] });
  await page.goto('https://app.example.com');

  // Connect first
  await page.click('[data-testid="connect-wallet"]');
  await expect(page.locator('[data-testid="connected"]')).toBeVisible();

  // Simulate disconnect
  await page.evaluate(() => {
    window.ethereum.emit('disconnect', { code: 4900, message: 'Disconnected' });
  });

  await expect(page.locator('[data-testid="connect-wallet"]')).toBeVisible();
});
```

### Testing wrong network

```typescript
test('app prompts network switch when on wrong chain', async ({ page }) => {
  await setupWalletMock(page, {
    accounts: ['0xAddr'],
    chainId: '0x38', // BSC, but app expects Ethereum
  });

  await page.goto('https://app.example.com');
  await page.click('[data-testid="connect-wallet"]');

  await expect(page.locator('[data-testid="wrong-network"]')).toBeVisible();
});
```

## AI agent E2E workflow

When an AI agent runs E2E tests against a dApp:

```text
1. Agent reads test scenario (target URL, expected flow, assertions)
2. Agent launches Playwright browser with wallet mock injected
3. Agent navigates to dApp, interacts with UI
4. Wallet mock auto-handles: connect, sign, approve, network switch
5. Agent captures: screenshots, tx hashes, error states
6. Agent produces proof artifacts for verification
```

### Proof artifact template

```text
[wallet-mock-e2e]
env: {testnet|mainnet-fork|local}
mock_wallet: {metamask|walletconnect|coinbase}
mock_address: {address}
chain_id: {chain_id}
scenario: {connect|sign|approve|swap|mint}
steps_executed: {count}
assertions_passed: {count}/{total}
tx_hashes: [{hash1}, {hash2}]
screenshots: {paths}
errors: {none|list}
```

## Common pitfalls

1. **Race condition on injection**: Always use `addInitScript` (Playwright) or `evaluateOnNewDocument` (Puppeteer) to inject before any dApp JS runs. Injecting after load is too late — dApps detect `window.ethereum` on init.

2. **EIP-6963 detection**: Modern dApps may use the newer wallet discovery standard. Mock the `eip6963:announceProvider` event:
   ```typescript
   window.dispatchEvent(new CustomEvent('eip6963:announceProvider', {
     detail: { info: { name: 'Mock Wallet', uuid: '...' }, provider: mockProvider }
   }));
   ```

3. **BigInt serialization**: Many wallet responses use hex strings. Ensure your mock returns hex-encoded values, not JS numbers — `'0x5208'` not `21000`.

4. **Event ordering**: Emit `accountsChanged` before `connect` events. Some dApps depend on this ordering.

5. **Multiple wallet detection**: If the dApp shows a wallet selector, make sure only your mock provider is present. Override any real `window.ethereum` that extensions may inject.

## Broadcast mode

The default mock never reaches a chain. Use broadcast mode only when the test must prove a real transaction, such as a testnet deposit whose receipt and balance change are checked afterwards.

- Set `broadcast: true`, `rpcUrl`, and `privateKey`.
- Keep the private key in the Playwright process. The page calls `window.__walletMockSend`, which is a Node function registered with `page.exposeFunction`.
- Proxy reads (`eth_call`, balances, receipts) through `window.__walletMockRpc` so the page sees the real chain.
- Refuse chain ID `1` and `999` unless `allowMainnet: true`. HyperEVM testnet is chain ID `998` (`0x3e6`).
- A mock hash does not change vault balances. Do not treat it as proof of a deposit or redeem.

The Playwright wiring is in `references/playwright-wallet-mock.md`.

## Reference implementations

For concrete integration examples, see `references/playwright-wallet-mock.md`.
