# plan-dog

`plan-dog` is a Codex skill for building or refreshing a documentation-first planning package before implementation. It helps produce or update:

- `PRD`
- technical design docs
- a master change plan
- split execution plans for API, backend, and frontend

## Repository Layout

```text
plan-dog/
├── SKILL.md
├── agents/
│   └── openai.yaml
└── references/
    └── plan-splitting.md
```

## Installation

Install the skill into your Codex global skills directory:

```bash
mkdir -p ~/.codex/skills
git clone git@github.com:fractalmind-ai/plan-dog.git ~/.codex/skills/plan-dog
```

If the directory already exists, update it in place:

```bash
git -C ~/.codex/skills/plan-dog pull
```

## Usage

The skill triggers when the task is about creating or refreshing PRDs, technical docs, a master plan, or split execution plans.

Typical requests:

- `Use plan-dog to create a full planning package for this feature`
- `Refresh the technical doc and downstream plans only`
- `Generate backend and frontend execution plans from the updated PRD`
