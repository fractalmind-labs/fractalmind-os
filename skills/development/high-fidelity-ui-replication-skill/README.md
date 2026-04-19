# high-fidelity-ui-replication-skill

Skill for near-match UI/animation replication from a live product, video, or screenshot set.

It helps agents turn a vague "make ours look like that" request into:
- a concrete replication spec
- a layered execution plan
- an artifact-based acceptance pack

## Install

```bash
npx openskills install fractalmind-ai/high-fidelity-ui-replication-skill
```

## Best for

- chart and dashboard interaction replication
- modal/sheet/open-close motion replication
- hover/tooltip/micro-interaction parity work
- high-fidelity visual QA and signoff packs

## Included files

**Core documentation:**
- `SKILL.md` - Complete skill guide with 5-phase workflow and DESIGN.md integration
- `LICENSE` - MIT license
- `README.md` - This file

**Examples (end-to-end case studies):**
- `examples/polymarket-btc-replication.md` - Complete Polymarket Bitcoin market replication walkthrough
- `examples/polymarket-DESIGN.md` - Real-world design system extracted from Polymarket
- `examples/chart-motion.md` - Chart animation replication patterns

**References (reusable templates):**
- `references/design-md-template.md` - Template for generating design system documentation
- `references/replication-spec-template.md` - Template for replication specifications
- `references/acceptance-checklist.md` - QA validation checklist

**Agent configurations:**
- `agents/openai.yaml` - OpenAI agent configuration example
