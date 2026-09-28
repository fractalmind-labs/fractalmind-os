# FractalMind Explorer

Frontend explorer for FractalMind Protocol objects and relationships on Sui.

## Prerequisites

- Node.js 20+
- npm 10+

## Local Development

```bash
npm ci
npm run dev
```

The app runs with Vite defaults (`http://localhost:5173`).

## Build

```bash
npm run build
npm run preview
```

## Sui SDK Notes

- Chain reads go through Sui's **GraphQL RPC** (`src/sui/graphql.ts`), not the
  deprecated public-fullnode JSON-RPC — see
  [`docs/sui-graphql-migration.md`](../../docs/sui-graphql-migration.md) for
  why, and `src/sui/bcs.ts` for the BCS schemas that decode object content
  (GraphQL returns raw BCS bytes, not JSON-RPC's decoded fields).
- This project uses `@mysten/sui` and `@mysten/bcs` for chain reads and BCS decoding.
- Keep SDK versions in `package.json` aligned with the lockfile and protocol SDK expectations.
- After SDK or contract updates, re-verify the BCS schemas in `src/sui/bcs.ts` against
  live objects — see the migration doc's verification method. A contract upgrade that
  changes a struct's on-chain layout (rare — Sui forbids it for existing instances,
  but new structs or dynamic fields can still shift what a query needs to select)
  will not surface as a type error, only as wrong or missing data at runtime.

## Deployment

- GitHub Pages deployment is handled by the repository's `.github/workflows/pages.yml`, which publishes
  the explorer under `/explorer/` of the docs site: https://fractalmind-labs.github.io/fractalmind-os/explorer/
