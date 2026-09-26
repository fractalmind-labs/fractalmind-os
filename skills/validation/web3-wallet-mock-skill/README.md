# web3-wallet-mock-skill

Mock Web3 browser wallets (MetaMask, WalletConnect, etc.) for AI Agent E2E testing.

Covers:
- EIP-1193 provider injection for Playwright/Puppeteer
- Transaction signing, approval, and network switching simulation
- WalletConnect session mocking
- EIP-6963 wallet discovery
- Error simulation (user rejection, wrong network, disconnected)
- CI integration patterns
- Proof artifact collection for AI agent workflows
- Optional broadcast mode: sign with a test private key in the Playwright process and send the transaction to a testnet RPC. The default remains a local mock hash. Mainnet chain IDs 1 and 999 are refused unless explicitly allowed.
