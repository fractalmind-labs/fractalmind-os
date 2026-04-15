export const products = [
  {
    name: 'oh-my-code',
    description: 'Reference workspace where the heartbeat-driven FractalMind OS runs: memory, OKRs, governance, dispatch, and outcomes.',
    icon: '&#x267b;',
    color: '#4DA2FF',
    link: 'https://github.com/fractalmind-ai/oh-my-code',
  },
  {
    name: 'fractalmind-okrs',
    description: 'Shared publication surface for candidate OKRs, portfolio review, and durable strategic memory.',
    icon: '&#x1f4ca;',
    color: '#e94560',
    link: 'https://github.com/fractalmind-ai/fractalmind-okrs',
  },
  {
    name: 'fractalbot',
    description: 'Multi-channel messaging bridge that routes humans and agents across Slack, Telegram, Discord, Feishu, and more.',
    icon: '&#x1f4e1;',
    color: '#4ecdc4',
    link: '/components/fractalbot',
  },
  {
    name: 'agent-manager',
    description: 'Execution plane for tmux-based agents with lifecycle management, monitoring, and dispatch support.',
    icon: '&#x1f916;',
    color: '#4ecdc4',
    link: '/components/agent-manager',
  },
  {
    name: 'fractalmind-protocol',
    description: 'Optional trust layer on SUI for identity, governance, and organization primitives when on-chain guarantees matter.',
    icon: '&#x26d3;',
    color: '#4DA2FF',
    link: '/components/protocol',
  },
  {
    name: 'fractalmind-envd',
    description: 'Go runtime for remote and distributed execution beyond a single machine.',
    icon: '&#x1f310;',
    color: '#4ecdc4',
    link: '/components/envd',
  },
  {
    name: 'explorer',
    description: 'Public visualization surface for organizations, components, and trust-critical state.',
    icon: '&#x1f50d;',
    color: '#e94560',
    link: 'https://fractalmind-ai.github.io/explorer',
  },
]

export const startHere = [
  {
    title: 'Understand the model',
    description: 'Read the OS-first framing: what FractalMind is, what problem it solves, and how the control loop works.',
    link: '/guide/what-is-fractalmind',
    cta: 'Read the overview',
  },
  {
    title: 'Get oriented quickly',
    description: 'Jump into the fastest path through the docs if you want the workflow, commands, and practical entry points first.',
    link: '/guide/quick-start',
    cta: 'Open quick start',
  },
  {
    title: 'Inspect the stack',
    description: 'Browse the core operating surfaces, supporting components, and the current shape of the public system.',
    link: '/components/overview',
    cta: 'Browse components',
  },
]

export const decisionPaths = [
  {
    audience: 'Operators & founders',
    title: 'Ship faster with a governed operating loop',
    description: 'Start with the workflow and docs path that shows how FractalMind turns requests into visible execution.',
    link: '/guide/quick-start',
    cta: 'Open operator path',
    proof: 'Best next proof: quick start → snapshot → surfaces',
  },
  {
    audience: 'Infra & platform builders',
    title: 'Inspect the runtime and control-plane surfaces',
    description: 'Go straight to the component map if you care about runtime boundaries, orchestration surfaces, and system shape.',
    link: '/components/overview',
    cta: 'Browse system surfaces',
    proof: 'Best next proof: components overview → architecture',
  },
  {
    audience: 'Protocol-curious teams',
    title: 'Verify the public trust and visibility layer',
    description: 'Jump directly into the explorer and public proof surfaces without getting trapped in a chain-first pitch.',
    link: 'https://fractalmind-ai.github.io/explorer',
    cta: 'Launch explorer',
    proof: 'Best next proof: explorer → public repos → trust section',
  },
]

export const sectionNav = [
  { label: 'Snapshot', href: '#snapshot' },
  { label: 'Start Here', href: '#start-here' },
  { label: 'Fit', href: '#fit' },
  { label: 'Surfaces', href: '#operating-surfaces' },
  { label: 'Stack', href: '#operating-stack' },
  { label: 'Proof', href: '#public-surfaces' },
  { label: 'Trust', href: '#trust' },
]

export const stats = [
  { value: '24', label: 'Public Repositories' },
  { value: String(products.length), label: 'Documented Surfaces' },
  { value: 'OS-first', label: 'Current Public Narrative' },
  { value: 'SUI Testnet', label: 'Optional Trust Surface' },
]

export const audiences = [
  {
    eyebrow: 'Operators & founders',
    title: 'For teams that need AI to ship visible work',
    description: 'FractalMind fits operators who want more than isolated copilots: approvals, memory, dispatch, and outcomes stay inside one repeatable system.',
    points: [
      'High-risk actions remain behind human approval',
      'Delivery stays observable across channels and repos',
      'Memory and candidate OKRs stay attached to execution',
    ],
  },
  {
    eyebrow: 'Infra & platform builders',
    title: 'For people designing the control plane',
    description: 'The stack is OS-first, so the core question becomes how teams, agents, and trust surfaces coordinate — not just how to call another tool.',
    points: [
      'Heartbeat loop for coordination and follow-through',
      'Modular surfaces for messaging, agent runtime, and governance',
      'Optional protocol layer when public guarantees matter',
    ],
  },
  {
    eyebrow: 'Protocol-curious teams',
    title: 'For buyers who need proof, not protocol maximalism',
    description: 'You can inspect docs, GitHub, explorer, and SUI-backed surfaces without forcing the whole story into a chain-first pitch.',
    points: [
      'Open repos for system shape and active components',
      'Explorer for public visibility and trust-oriented views',
      'Protocol remains available as an optional verification layer',
    ],
  },
]

export const milestones = [
  { date: '2025 Q4', title: 'Protocol trust layer validated', description: 'fractalmind-protocol shipped to SUI Testnet as the optional trust surface.' },
  { date: '2026 Q1', title: 'FractalMind OS control loop aligned', description: 'SOUL, HEARTBEAT, runtime memory, and heartbeat execution now share one operating model.' },
  { date: '2026 Q1', title: 'Candidate OKR sync live', description: 'Strategic candidates now publish through fractalmind-okrs instead of staying trapped in one terminal.' },
  { date: '2026 Q1', title: 'Multi-channel execution running', description: 'fractalbot + agent-manager route humans to agents and keep delivery observable.' },
  { date: '2026 Q1', title: 'Public surfaces being re-aligned', description: 'Docs and GitHub are being updated from a protocol-first story to the current OS-first reality.' },
]

export const githubLinks = [
  {
    label: '24 Repositories',
    description: 'Browse the full public org: OS kernel, execution surfaces, protocol, tooling, and application repos.',
    url: 'https://github.com/fractalmind-ai',
    external: true,
  },
  {
    label: 'Architecture Overview',
    description: 'Read the layered operating model before diving into individual repos.',
    url: '/architecture/overview',
    external: false,
  },
  {
    label: 'Live Explorer',
    description: 'Inspect the public visualization / trust surface.',
    url: 'https://fractalmind-ai.github.io/explorer',
    external: true,
  },
]

export const proofSurfaces = [
  {
    label: 'Read the model',
    title: 'OS-first framing in docs',
    description: 'Start with the narrative shift: FractalMind is presented first as an operating system for agent teams, then as a trust-aware public stack.',
    link: '/guide/what-is-fractalmind',
    cta: 'Open the overview',
    external: false,
  },
  {
    label: 'Inspect the org',
    title: 'Public GitHub footprint',
    description: 'Review the public repositories directly to validate that the docs story maps to real repos, components, and operating surfaces.',
    link: 'https://github.com/fractalmind-ai',
    cta: 'Browse the org',
    external: true,
  },
  {
    label: 'Verify the surface',
    title: 'Explorer + trust layer',
    description: 'Use the explorer when you want the public visualization surface and the protocol-facing side of the stack in one place.',
    link: 'https://fractalmind-ai.github.io/explorer',
    cta: 'Launch explorer',
    external: true,
  },
]
