# Contributing to FractalMind AI Docs

Thanks for your interest in contributing! This repo powers the documentation site at https://fractalmind-ai.github.io.

## Getting Started

```bash
git clone https://github.com/fractalmind-ai/fractalmind-ai.github.io.git
cd fractalmind-ai.github.io
npm ci
npm run docs:dev
```

## How to Contribute

### Documentation Changes

1. Fork the repo and create a branch: `git checkout -b docs/my-change`
2. Edit or add Markdown files in `docs/`
3. Run `npm run docs:build` to verify no build errors
4. Submit a PR with a clear description of what changed and why

### Page Structure

- `docs/guide/` — Getting started guides
- `docs/architecture/` — System architecture docs
- `docs/components/` — Individual component documentation
- `docs/protocol/` — SUI smart contract and SDK docs
- `docs/roadmap/` — Project roadmap

### Writing Guidelines

- Keep protocol behavior docs synchronized with the Move contracts and SDK
- For any API or state-machine change, update docs in the same PR
- Include runnable examples whenever adding new flows
- Prefer concise diagrams (Mermaid or ASCII) for lifecycle and authorization changes
- Use VitePress [Markdown Extensions](https://vitepress.dev/guide/markdown) where helpful (e.g., `::: tip`, code groups)

### Custom Theme

The site uses a custom VitePress theme located in `docs/.vitepress/theme/`. If you're modifying the landing page or visual components:

- `docs/.vitepress/theme/components/BrandHome.vue` — Landing page
- `docs/.vitepress/theme/custom.css` — Global style overrides
- `docs/.vitepress/config.ts` — Navigation and sidebar config

## PR Guidelines

- One topic per PR
- Include a clear title and description
- Verify `npm run docs:build` passes before submitting
- If adding a new page, update the sidebar config in `docs/.vitepress/config.ts`

## Reporting Issues

Use [GitHub Issues](https://github.com/fractalmind-ai/fractalmind-ai.github.io/issues) with the appropriate template:
- **Bug Report** — for broken pages, links, or rendering issues
- **Feature Request** — for new content or site improvements

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
