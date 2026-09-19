# react-frontend-dev

`react-frontend-dev` is a Codex skill for building and updating React frontends with a practical default stack and delivery guardrails:

- `pnpm` + `Vite`
- `Tailwind CSS`
- `TanStack Query`
- `BrowserRouter`
- `zustand`
- structured data presentation patterns
- flat-first UI composition
- primary-path-first error handling
- real integrations replacing mock residue once accounts and keys are ready

## Repository Layout

```text
react-frontend-dev/
├── SKILL.md
├── agents/
│   └── openai.yaml
└── references/
    ├── admin-app.md
    ├── docs-sync.md
    ├── monorepo.md
    └── user-app.md
```

## Installation

Install with the Codex skill installer:

```bash
python ~/.codex/skills/.system/skill-installer/scripts/install-skill-from-github.py \
  --repo fractalmind-ai/react-frontend-dev-skill \
  --path . \
  --name react-frontend-dev
```

Manual install also works:

```bash
mkdir -p ~/.codex/skills
git clone git@github.com:fractalmind-ai/react-frontend-dev-skill.git ~/.codex/skills/react-frontend-dev
```

If the directory already exists, update it in place:

```bash
git -C ~/.codex/skills/react-frontend-dev pull
```

Restart Codex after installation so the new skill is picked up.

## Usage

Use this skill when the task is about:

- building or updating a React frontend
- user app or admin console structure
- routing, data fetching, and state management patterns
- shared frontend layers in a monorepo
- frontend technical docs that need to stay aligned with implementation

Typical requests:

- `Use react-frontend-dev to build this new React app flow`
- `Refactor this admin page with shared query/state patterns`
- `Fix this frontend to use real APIs instead of mock data`
- `Update the frontend docs after changing routes and tabs`
