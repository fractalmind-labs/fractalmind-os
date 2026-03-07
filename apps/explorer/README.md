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

- This project uses `@mysten/sui` for chain reads.
- Keep SDK version in `package.json` aligned with the lockfile and protocol SDK expectations.
- After SDK updates, verify object query and parsing behavior in `src/sui/queries.ts`.

## Deployment

- GitHub Pages deployment is handled by `.github/workflows/deploy.yml`.
