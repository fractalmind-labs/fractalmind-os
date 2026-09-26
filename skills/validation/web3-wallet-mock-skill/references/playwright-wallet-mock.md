# Playwright Wallet Mock — Complete Example

## Project setup

```bash
npm init -y
npm install -D @playwright/test ethers
npx playwright install chromium
```

## Mock provider factory

```typescript
// wallet-mock.ts
import { ethers } from 'ethers';

export interface WalletMockConfig {
  accounts: string[];
  privateKey: string;        // For producing valid signatures
  chainId: string;           // Hex, e.g. '0x1'
  balance?: string;          // Wei hex, default 10 ETH
  autoApprove?: boolean;     // Auto-approve tx signing (default true)
}

export function createMockProviderScript(config: WalletMockConfig): string {
  return `
    (() => {
      const accounts = ${JSON.stringify(config.accounts)};
      let chainId = '${config.chainId}';
      const balance = '${config.balance || '0x8AC7230489E80000'}';
      const autoApprove = ${config.autoApprove ?? true};
      const listeners = {};
      let txCount = 0;

      function emit(event, data) {
        (listeners[event] || []).forEach(cb => cb(data));
      }

      window.ethereum = {
        isMetaMask: true,
        selectedAddress: accounts[0],
        chainId,
        networkVersion: String(parseInt(chainId, 16)),
        isConnected: () => true,
        _isMock: true,
        _sentTxs: [],

        request: async ({ method, params }) => {
          console.log('[wallet-mock]', method, params);
          switch (method) {
            case 'eth_requestAccounts':
            case 'eth_accounts':
              return accounts;
            case 'eth_chainId':
              return chainId;
            case 'net_version':
              return String(parseInt(chainId, 16));
            case 'eth_call':
            case 'eth_getBalance':
            case 'eth_blockNumber':
            case 'eth_estimateGas':
            case 'eth_gasPrice':
            case 'eth_getTransactionCount':
            case 'eth_getTransactionReceipt':
              if (typeof window.__walletMockRpc === 'function') {
                return window.__walletMockRpc(method, params || []);
              }
              if (method === 'eth_call') return '0x' + '0'.repeat(64);
              if (method === 'eth_getBalance') return balance;
              if (method === 'eth_blockNumber') return '0x100';
              if (method === 'eth_estimateGas') return '0x5208';
              if (method === 'eth_gasPrice') return '0x3B9ACA00';
              return '0x' + txCount.toString(16);
            case 'eth_sendTransaction': {
              if (!autoApprove) throw { code: 4001, message: 'User rejected' };
              if (typeof window.__walletMockSend === 'function') {
                const hash = await window.__walletMockSend(params[0]);
                txCount++;
                window.ethereum._sentTxs.push({ ...params[0], hash, broadcast: true });
                return hash;
              }
              const hash = '0x' + Array.from({length: 64}, () =>
                Math.floor(Math.random()*16).toString(16)).join('');
              txCount++;
              window.ethereum._sentTxs.push({ ...params[0], hash });
              return hash;
            }
            case 'personal_sign':
              // Return a dummy valid-length signature
              return '0x' + 'ab'.repeat(65);
            case 'eth_signTypedData_v4':
              return '0x' + 'cd'.repeat(65);
            case 'wallet_switchEthereumChain': {
              chainId = params[0].chainId;
              emit('chainChanged', chainId);
              return null;
            }
            case 'wallet_addEthereumChain': {
              chainId = params[0].chainId;
              emit('chainChanged', chainId);
              return null;
            }
            case 'wallet_watchAsset':
              return true;
            default:
              console.warn('[wallet-mock] unhandled:', method);
              throw { code: 4200, message: 'Unsupported: ' + method };
          }
        },

        on(event, cb) {
          if (!listeners[event]) listeners[event] = [];
          listeners[event].push(cb);
          return this;
        },
        removeListener(event, cb) {
          listeners[event] = (listeners[event] || []).filter(f => f !== cb);
          return this;
        },
        removeAllListeners(event) {
          if (event) delete listeners[event];
          else Object.keys(listeners).forEach(k => delete listeners[k]);
          return this;
        },
        emit,
      };

      // EIP-6963 announcement for modern dApps
      window.dispatchEvent(new CustomEvent('eip6963:announceProvider', {
        detail: {
          info: {
            uuid: 'mock-wallet-0001',
            name: 'Mock Wallet',
            icon: 'data:image/svg+xml,<svg/>',
            rdns: 'io.mock.wallet',
          },
          provider: window.ethereum,
        },
      }));

      // Re-announce on request
      window.addEventListener('eip6963:requestProvider', () => {
        window.dispatchEvent(new CustomEvent('eip6963:announceProvider', {
          detail: {
            info: {
              uuid: 'mock-wallet-0001',
              name: 'Mock Wallet',
              icon: 'data:image/svg+xml,<svg/>',
              rdns: 'io.mock.wallet',
            },
            provider: window.ethereum,
          },
        }));
      });

      console.log('[wallet-mock] injected, accounts:', accounts, 'chainId:', chainId);
    })();
  `;
}
```

## Test examples

### Connect wallet and read balance

```typescript
// tests/connect.spec.ts
import { test, expect } from '@playwright/test';
import { createMockProviderScript } from './wallet-mock';

const MOCK_ADDR = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(createMockProviderScript({
    accounts: [MOCK_ADDR],
    privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
    chainId: '0x1',
    balance: '0xDE0B6B3A7640000', // 1 ETH
  }));
});

test('connect wallet shows address', async ({ page }) => {
  await page.goto('https://app.example.com');
  await page.click('[data-testid="connect-wallet"]');
  await expect(page.locator('[data-testid="wallet-address"]'))
    .toContainText(MOCK_ADDR.slice(0, 6));
});
```

### Simulate transaction rejection

```typescript
test('shows error when user rejects transaction', async ({ page }) => {
  await page.addInitScript(createMockProviderScript({
    accounts: [MOCK_ADDR],
    privateKey: '0x...',
    chainId: '0x1',
    autoApprove: false, // Will throw 4001 on eth_sendTransaction
  }));

  await page.goto('https://app.example.com');
  await page.click('[data-testid="connect-wallet"]');
  await page.click('[data-testid="send-tx-btn"]');

  await expect(page.locator('[data-testid="error-toast"]'))
    .toContainText('rejected');
});
```

### Verify sent transactions

```typescript
test('approve sends correct calldata', async ({ page }) => {
  // ... setup + navigate + connect ...

  await page.click('[data-testid="approve-btn"]');

  // Read back what the mock captured
  const sentTxs = await page.evaluate(() => window.ethereum._sentTxs);
  expect(sentTxs).toHaveLength(1);
  expect(sentTxs[0].to).toBe('0xExpectedContractAddress');
  // approve(address,uint256) selector = 0x095ea7b3
  expect(sentTxs[0].data).toMatch(/^0x095ea7b3/);
});
```

### Network switch flow

```typescript
test('app triggers network switch to Polygon', async ({ page }) => {
  await page.addInitScript(createMockProviderScript({
    accounts: [MOCK_ADDR],
    privateKey: '0x...',
    chainId: '0x1', // Start on Ethereum
  }));

  await page.goto('https://app.example.com');
  await page.click('[data-testid="connect-wallet"]');

  // App should detect wrong chain and show switch button
  await page.click('[data-testid="switch-to-polygon"]');

  // Verify the mock processed the switch
  const newChain = await page.evaluate(() => window.ethereum.chainId);
  expect(newChain).toBe('0x89'); // Polygon
});
```

## Broadcast to a testnet

Use this when the dApp transaction must exist on a chain. The default mock above still returns a random hash when `__walletMockSend` is absent.

```typescript
import { ethers } from 'ethers';
import { createMockProviderScript } from './wallet-mock';

export async function setupBroadcastWallet(page, config: {
  rpcUrl: string;
  privateKey: string;
  chainId: string; // hex, 998 is 0x3e6
  allowMainnet?: boolean;
}) {
  const chainId = parseInt(config.chainId, 16);
  if (!config.allowMainnet && (chainId === 1 || chainId === 999)) {
    throw new Error('broadcast refuses Ethereum mainnet and HyperEVM mainnet');
  }
  const provider = new ethers.JsonRpcProvider(config.rpcUrl, chainId);
  const wallet = new ethers.Wallet(config.privateKey, provider);
  const address = await wallet.getAddress();

  await page.exposeFunction('__walletMockRpc', (method: string, params: unknown[]) =>
    provider.send(method, params));
  await page.exposeFunction('__walletMockSend', async (tx: { to: string; data?: string; value?: string }) => {
    const sent = await wallet.sendTransaction({
      to: tx.to,
      data: tx.data,
      value: tx.value ? BigInt(tx.value) : undefined,
    });
    return sent.hash;
  });
  await page.addInitScript(createMockProviderScript({
    accounts: [address],
    privateKey: config.privateKey,
    chainId: config.chainId,
    autoApprove: true,
  }));
}
```

Call `setupBroadcastWallet` before `page.goto`. The private key stays in Node. HyperEVM testnet uses chain ID `998` (`0x3e6`). Do not set `allowMainnet` for a test.

## CI integration

```yaml
# .github/workflows/e2e.yml
name: E2E Wallet Tests
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - run: npx playwright test
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: playwright-report
          path: playwright-report/
```

## Tips for AI agent usage

1. **Screenshot on every step**: Capture visual proof after each wallet interaction
   ```typescript
   await page.screenshot({ path: `step-${stepNum}.png` });
   ```

2. **Log all RPC calls**: The mock logs to console — capture with:
   ```typescript
   page.on('console', msg => {
     if (msg.text().includes('[wallet-mock]')) console.log(msg.text());
   });
   ```

3. **Assert on mock internals**: Use `page.evaluate(() => window.ethereum._sentTxs)` to verify exactly what the dApp sent, independent of UI state.

4. **Multi-wallet testing**: Run the same test suite with different mock configs (MetaMask, Coinbase Wallet, etc.) by varying the `isMetaMask` / `isCoinbaseWallet` flags.
