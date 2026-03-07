# Design Decisions

Key technical choices and the reasoning behind them.

## Why SUI?

**Decision**: Use SUI blockchain for the protocol layer.

**Alternatives considered**: Ethereum, Solana, Aptos, off-chain database.

**Rationale**:
- **Object-centric model** maps naturally to organizations, agents, and tasks as first-class objects
- **Move language** provides strong ownership guarantees — an agent certificate can only be used by its owner
- **Low transaction costs** make it practical to record individual task completions
- **Parallel execution** enables high throughput for multi-agent organizations

## Why tmux (not Docker/K8s)?

**Decision**: Use tmux sessions for agent management.

**Rationale**:
- **Zero infrastructure**: No Docker daemon, no Kubernetes cluster, no cloud account
- **Instant start**: `tmux new-session` is milliseconds, not seconds
- **Observable**: Attach to any agent session and see what it's doing in real-time
- **Recoverable**: tmux sessions survive SSH disconnects
- **Simple**: A shell-literate AI agent can manage tmux without learning container APIs

## Why Files Over Databases?

**Decision**: Use files (YAML, Markdown, JSONL) for most data storage.

**Rationale**:
- **Git-friendly**: Everything is version-controlled naturally
- **Human-readable**: No special tools needed to inspect state
- **AI-friendly**: LLMs are better at reading/writing text files than SQL
- **No server**: No database process to manage, backup, or migrate
- **Composable**: Different tools can read the same files without API integration

## Why openskills (not a monolith)?

**Decision**: Distribute skills as independent packages via `npx openskills install`.

**Rationale**:
- **No lock-in**: Install only what you need
- **Independent versioning**: Each skill evolves at its own pace
- **Low coupling**: Skills communicate through files and CLI, not internal APIs
- **Easy contribution**: Anyone can create and publish a skill

## Why Lead-Based Teams (not Consensus)?

**Decision**: Teams have a designated lead agent who coordinates.

**Rationale**:
- **Simplicity**: One decision-maker is faster than consensus protocols
- **Proven pattern**: Mirrors how human engineering teams work
- **Accountability**: Clear ownership of team outcomes
- **Scalable**: Lead can delegate to sub-leads as team grows (fractal pattern)

## What We Explicitly Don't Do

| Decision | Reasoning |
|----------|-----------|
| **No AI model** | We're model-agnostic. Users choose their own LLM. |
| **No SaaS platform** | We provide tools, users deploy themselves. |
| **No agent runtime** | Agents run in the user's environment (tmux/Docker/systemd). |
| **No monolith framework** | Every component installs independently. |
| **No GUI requirement** | All operations work via CLI. GUI is optional. |

## Technology Stack

| Component | Language | Why |
|-----------|----------|-----|
| Protocol (contracts) | Move | SUI native, strong ownership model |
| Protocol (SDK) | TypeScript | Web ecosystem, easy integration |
| fractalbot | Go | Fast binary, good concurrency, easy deploy |
| Management skills | Python | Widely available, good tmux/subprocess support |
| Documentation | VitePress | Fast, clean, Markdown-native |
