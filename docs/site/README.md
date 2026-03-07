# FractalMind Docs Site

VitePress documentation site for the FractalMind ecosystem.

## Prerequisites

- Node.js 20+
- npm 10+

## Local Development

```bash
npm ci
npm run docs:dev
```

## Build and Preview

```bash
npm run docs:build
npm run docs:preview
```

## Deployment

- GitHub Pages deploy is managed by `.github/workflows/deploy.yml`.
- Deploys on pushes to `main`.

## Contributing

1. Keep protocol behavior docs synchronized with the Move contracts and SDK.
2. For any API/state-machine change, update docs in the same PR.
3. Include runnable examples whenever adding new flows.
4. Prefer concise diagrams for lifecycle and authorization changes.
