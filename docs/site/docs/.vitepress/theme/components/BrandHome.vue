<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { collectSectionMeasurements, resolveActiveSectionHref } from '../utils/homepageScrollSpy'
import {
  audiences,
  decisionPaths,
  githubLinks,
  milestones,
  products,
  proofSurfaces,
  sectionNav,
  startHere,
  stats,
} from '../utils/homepageContent'

const visible = ref(false)
const activeSection = ref(sectionNav[0]?.href ?? '#snapshot')

let cleanupScrollSpy = () => {}

onMounted(() => {
  visible.value = true

  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return
  }

  let rafId = 0
  let initialSyncTimeout: number | undefined

  const updateActiveSection = () => {
    const scrollY = window.scrollY || window.pageYOffset || 0
    const measurements = collectSectionMeasurements(sectionNav, document, scrollY)

    activeSection.value = resolveActiveSectionHref(
      measurements,
      scrollY,
      220,
      sectionNav[0]?.href ?? '#snapshot',
    )
  }

  const scheduleUpdate = () => {
    if (rafId) {
      window.cancelAnimationFrame(rafId)
    }

    rafId = window.requestAnimationFrame(() => {
      updateActiveSection()
      rafId = 0
    })
  }

  scheduleUpdate()
  initialSyncTimeout = window.setTimeout(scheduleUpdate, 120)

  window.addEventListener('scroll', scheduleUpdate, { passive: true })
  window.addEventListener('resize', scheduleUpdate)
  window.addEventListener('hashchange', scheduleUpdate)

  cleanupScrollSpy = () => {
    if (rafId) {
      window.cancelAnimationFrame(rafId)
    }

    if (initialSyncTimeout !== undefined) {
      window.clearTimeout(initialSyncTimeout)
    }

    window.removeEventListener('scroll', scheduleUpdate)
    window.removeEventListener('resize', scheduleUpdate)
    window.removeEventListener('hashchange', scheduleUpdate)
  }
})

onBeforeUnmount(() => {
  cleanupScrollSpy()
})
</script>

<template>
  <div class="brand-home" :class="{ visible }">
    <!-- Hero Section -->
    <section class="hero-section">
      <div class="hero-bg">
        <div class="fractal-grid">
          <svg
            v-for="i in 6"
            :key="i"
            class="fractal-triangle"
            :class="`ft-${i}`"
            viewBox="0 0 100 100"
            fill="none"
          >
            <path d="M50 10L90 80H10L50 10Z" stroke="currentColor" stroke-width="1" opacity="0.15" />
            <path d="M50 30L70 70H30L50 30Z" stroke="currentColor" stroke-width="1" opacity="0.1" />
          </svg>
        </div>
        <div class="hero-orb hero-orb-a"></div>
        <div class="hero-orb hero-orb-b"></div>
      </div>
      <div class="section-container hero-shell">
        <div class="hero-copy">
          <div class="hero-kicker-row">
            <span class="hero-kicker">OS-first AI operations</span>
            <span class="hero-inline-proof">Heartbeat / Memory / Governance / Dispatch</span>
          </div>

          <div class="hero-logo">
            <svg width="72" height="72" viewBox="0 0 32 32" fill="none">
              <path d="M16 4L28 26H4L16 4Z" fill="#00d992" opacity="0.92" />
              <path d="M16 10L22 22H10L16 10Z" fill="#050507" />
              <path d="M16 14L19 20H13L16 14Z" fill="#4DA2FF" opacity="0.9" />
            </svg>
          </div>

          <h1 class="hero-title">
            <span class="title-main">FractalMind AI</span>
            <span class="title-sub">Operating system for AI agent teams that need structure, speed, and human control.</span>
          </h1>

          <p class="hero-description">
            Open-source runtime for governed autonomy, structured memory, multi-channel execution,
            and optional on-chain trust surfaces — designed to move real work instead of stopping at demos.
          </p>

          <div class="hero-selling-points">
            <div class="selling-point">
              <span class="sp-icon">&#x1f49a;</span>
              <div>
                <strong>Repeatable operating loop</strong>
                <p>Run delivery through one visible control system: signal, memory, candidate OKR, governance, execution, and outcome.</p>
              </div>
            </div>
            <div class="selling-point">
              <span class="sp-icon">&#x2699;&#xfe0f;</span>
              <div>
                <strong>Governed autonomy by default</strong>
                <p>Low-risk work can move automatically while production, money, and public actions stay behind human approval.</p>
              </div>
            </div>
            <div class="selling-point">
              <span class="sp-icon">&#x1f5a7;&#xfe0f;</span>
              <div>
                <strong>Trust surfaces when they matter</strong>
                <p>Use docs, GitHub, explorer, and SUI primitives as verification layers — without forcing the whole product into a protocol-only story.</p>
              </div>
            </div>
          </div>

          <div class="hero-actions">
            <a href="/guide/quick-start" class="btn btn-primary">Quick Start</a>
            <a href="https://fractalmind-ai.github.io/explorer" class="btn btn-secondary" target="_blank" rel="noopener">Live Explorer</a>
            <a href="https://github.com/fractalmind-ai" class="btn btn-ghost" target="_blank" rel="noopener">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
              </svg>
              GitHub
            </a>
          </div>

          <div class="hero-paths">
            <div class="hero-paths-header">
              <span class="hero-paths-eyebrow">Choose your fastest path</span>
              <p>Pick the lens that matches your job-to-be-done and jump straight to the right next proof.</p>
            </div>
            <div class="hero-path-grid">
              <a
                v-for="path in decisionPaths"
                :key="path.audience"
                :href="path.link"
                class="hero-path-card"
                :target="path.link.startsWith('http') ? '_blank' : undefined"
                :rel="path.link.startsWith('http') ? 'noopener' : undefined"
              >
                <span class="hero-path-audience">{{ path.audience }}</span>
                <strong>{{ path.title }}</strong>
                <p>{{ path.description }}</p>
                <span class="hero-path-proof">{{ path.proof }}</span>
                <span class="hero-path-cta">{{ path.cta }} &rarr;</span>
              </a>
            </div>
          </div>

          <nav class="section-nav" aria-label="Homepage sections">
            <a
              v-for="item in sectionNav"
              :key="item.href"
              :href="item.href"
              :class="['section-nav-link', { 'is-active': activeSection === item.href }]"
              :aria-current="activeSection === item.href ? 'location' : undefined"
              @click="activeSection = item.href"
            >
              {{ item.label }}
            </a>
          </nav>
        </div>

        <div class="hero-panel">
          <div class="hero-panel-top">
            <span class="panel-pill">Current public story</span>
            <span class="panel-status">OS-first refresh</span>
          </div>

          <div class="hero-command">
            <span class="command-label">control loop</span>
            <code>signal → memory → candidate OKR → governance → execution → outcome</code>
          </div>

          <div class="hero-panel-grid">
            <div class="panel-metric panel-metric-accent">
              <span class="panel-metric-label">Operating model</span>
              <strong>Heartbeat runtime</strong>
              <p>Teams, agents, and delivery stay on one repeatable system.</p>
            </div>
            <div class="panel-metric">
              <span class="panel-metric-label">Human control</span>
              <strong>Approval stays in the loop</strong>
              <p>High-risk execution remains explicitly governed instead of hidden in prompts.</p>
            </div>
            <div class="panel-metric panel-metric-wide">
              <span class="panel-metric-label">Public verification</span>
              <strong>Docs, GitHub, explorer, protocol</strong>
              <p>Trust-critical proof can stay inspectable through open repos, live surfaces, and optional SUI primitives.</p>
            </div>
          </div>

          <div class="hero-chip-row">
            <span class="hero-chip">Open source</span>
            <span class="hero-chip">Multi-channel</span>
            <span class="hero-chip">Structured memory</span>
            <span class="hero-chip">Governed autonomy</span>
          </div>
        </div>
      </div>
    </section>

    <!-- Stats Bar -->
    <section id="snapshot" class="stats-section">
      <div class="section-container">
        <div class="stats-shell">
          <div class="stats-intro">
            <span class="stats-eyebrow">Public operating snapshot</span>
            <h2>What is live right now</h2>
            <p>The homepage now leads with the runtime reality: an operating system story, then the public trust surfaces around it.</p>
          </div>
          <div class="stats-container">
            <div v-for="stat in stats" :key="stat.label" class="stat-item">
              <span class="stat-value">{{ stat.value }}</span>
              <span class="stat-label">{{ stat.label }}</span>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- Start Here -->
    <section id="start-here" class="start-here-section">
      <div class="section-container">
        <div class="start-here-header">
          <div class="stage-badge">Start Here</div>
          <h2 class="section-title">The fastest way into FractalMind</h2>
          <p class="section-subtitle">
            New to the project? Start with the model, then the quick start, then the component map.
          </p>
        </div>
        <div class="start-here-grid">
          <a v-for="(item, index) in startHere" :key="item.title" :href="item.link" class="start-card">
            <div class="start-card-top">
              <span class="start-step">0{{ index + 1 }}</span>
              <span class="start-card-arrow">&rarr;</span>
            </div>
            <h3>{{ item.title }}</h3>
            <p>{{ item.description }}</p>
            <span class="start-card-link">{{ item.cta }}</span>
          </a>
        </div>
      </div>
    </section>

    <!-- Problem / Solution -->
    <section class="problem-solution-section">
      <div class="section-container">
        <div class="ps-grid">
          <div class="ps-card problem">
            <h3>The Problem</h3>
            <p>
              Most AI stacks stop at chat, tools, or single-agent orchestration. Real operations
              still leak through ad hoc memory, manual follow-up, and unclear ownership. As the
              number of agents grows, teams need a repeatable operating system — not just another framework.
            </p>
          </div>
          <div class="ps-card solution">
            <h3>The Solution</h3>
            <p>
              FractalMind now centers on a <strong>heartbeat-driven OS</strong>: structured memory,
              candidate OKRs, governed autonomy, agent dispatch, and outcome tracking. The
              protocol and explorer remain valuable trust surfaces, but the daily system runs
              through an OS-first control loop instead of a protocol-only story.
            </p>
          </div>
        </div>
      </div>
    </section>

    <!-- Audience Fit -->
    <section id="fit" class="audience-section">
      <div class="section-container">
        <h2 class="section-title">Who FractalMind Fits</h2>
        <p class="section-subtitle">
          Different buyers need different proof. The OS story now makes that fit explicit instead of forcing everyone through the same protocol-first path.
        </p>
        <div class="audience-grid">
          <article
            v-for="audience in audiences"
            :key="audience.title"
            class="audience-card"
          >
            <span class="audience-eyebrow">{{ audience.eyebrow }}</span>
            <h3>{{ audience.title }}</h3>
            <p>{{ audience.description }}</p>
            <ul class="audience-points">
              <li v-for="point in audience.points" :key="point">{{ point }}</li>
            </ul>
          </article>
        </div>
      </div>
    </section>

    <!-- Product Matrix -->
    <section id="operating-surfaces" class="products-section">
      <div class="section-container">
        <h2 class="section-title">Core Operating Surfaces</h2>
        <p class="section-subtitle">The current system is OS-first: communication, execution, governance, and trust surfaces.</p>
        <div class="products-grid">
          <a
            v-for="(product, index) in products"
            :key="product.name"
            :href="product.link"
            class="product-card"
          >
            <div class="product-card-head">
              <span class="product-tag">Surface 0{{ index + 1 }}</span>
              <div class="product-icon" :style="{ color: product.color }">
                <span v-html="product.icon"></span>
              </div>
            </div>
            <h3 class="product-name">{{ product.name }}</h3>
            <p class="product-description">{{ product.description }}</p>
            <div class="product-footer">
              <span class="product-link-label">Inspect surface</span>
              <span class="product-link-arrow">&rarr;</span>
            </div>
            <div class="product-accent" :style="{ backgroundColor: product.color }"></div>
          </a>
        </div>
      </div>
    </section>

    <!-- Architecture Diagram -->
    <section id="operating-stack" class="architecture-section">
      <div class="section-container">
        <h2 class="section-title">Current Operating Stack</h2>
        <p class="section-subtitle">Heartbeat-driven coordination with optional on-chain trust layers.</p>
        <div class="arch-diagram">
          <svg viewBox="0 0 800 420" fill="none" class="arch-svg">
            <!-- Background grid dots -->
            <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
              <circle cx="20" cy="20" r="1" fill="#4ecdc4" opacity="0.15" />
            </pattern>
            <rect width="800" height="420" fill="url(#grid)" />

            <!-- L3: Organization -->
            <rect x="250" y="20" width="300" height="60" rx="8" fill="#0f3460" stroke="#4DA2FF" stroke-width="1.5" />
            <text x="400" y="45" text-anchor="middle" fill="#4DA2FF" font-size="11" font-weight="600">L3: Organization (On-Chain)</text>
            <text x="400" y="62" text-anchor="middle" fill="#8892b0" font-size="10">fractalmind-protocol on SUI</text>

            <!-- Lines from L3 to L2 -->
            <line x1="330" y1="80" x2="200" y2="130" stroke="#4DA2FF" stroke-width="1" opacity="0.4" />
            <line x1="400" y1="80" x2="400" y2="130" stroke="#4DA2FF" stroke-width="1" opacity="0.4" />
            <line x1="470" y1="80" x2="600" y2="130" stroke="#4DA2FF" stroke-width="1" opacity="0.4" />

            <!-- L2: Teams -->
            <rect x="100" y="130" width="200" height="55" rx="8" fill="#0f3460" stroke="#4ecdc4" stroke-width="1.5" />
            <text x="200" y="155" text-anchor="middle" fill="#4ecdc4" font-size="11" font-weight="600">L2: Team A</text>
            <text x="200" y="172" text-anchor="middle" fill="#8892b0" font-size="10">team-manager</text>

            <rect x="300" y="130" width="200" height="55" rx="8" fill="#0f3460" stroke="#4ecdc4" stroke-width="1.5" />
            <text x="400" y="155" text-anchor="middle" fill="#4ecdc4" font-size="11" font-weight="600">L2: Team B</text>
            <text x="400" y="172" text-anchor="middle" fill="#8892b0" font-size="10">team-manager</text>

            <rect x="500" y="130" width="200" height="55" rx="8" fill="#0f3460" stroke="#4ecdc4" stroke-width="1.5" />
            <text x="600" y="155" text-anchor="middle" fill="#4ecdc4" font-size="11" font-weight="600">L2: Team C</text>
            <text x="600" y="172" text-anchor="middle" fill="#8892b0" font-size="10">team-manager</text>

            <!-- Lines from L2 to L1 -->
            <line x1="150" y1="185" x2="120" y2="230" stroke="#4ecdc4" stroke-width="1" opacity="0.4" />
            <line x1="250" y1="185" x2="280" y2="230" stroke="#4ecdc4" stroke-width="1" opacity="0.4" />
            <line x1="350" y1="185" x2="360" y2="230" stroke="#4ecdc4" stroke-width="1" opacity="0.4" />
            <line x1="450" y1="185" x2="440" y2="230" stroke="#4ecdc4" stroke-width="1" opacity="0.4" />
            <line x1="560" y1="185" x2="540" y2="230" stroke="#4ecdc4" stroke-width="1" opacity="0.4" />
            <line x1="640" y1="185" x2="660" y2="230" stroke="#4ecdc4" stroke-width="1" opacity="0.4" />

            <!-- L1: Agents -->
            <rect x="60" y="230" width="120" height="50" rx="6" fill="#1a1a2e" stroke="#e94560" stroke-width="1.5" />
            <text x="120" y="252" text-anchor="middle" fill="#e94560" font-size="10" font-weight="600">Agent</text>
            <text x="120" y="268" text-anchor="middle" fill="#8892b0" font-size="9">agent-manager</text>

            <rect x="220" y="230" width="120" height="50" rx="6" fill="#1a1a2e" stroke="#e94560" stroke-width="1.5" />
            <text x="280" y="252" text-anchor="middle" fill="#e94560" font-size="10" font-weight="600">Agent</text>
            <text x="280" y="268" text-anchor="middle" fill="#8892b0" font-size="9">agent-manager</text>

            <rect x="340" y="230" width="120" height="50" rx="6" fill="#1a1a2e" stroke="#e94560" stroke-width="1.5" />
            <text x="400" y="252" text-anchor="middle" fill="#e94560" font-size="10" font-weight="600">Lead Agent</text>
            <text x="400" y="268" text-anchor="middle" fill="#8892b0" font-size="9">agent-manager</text>

            <rect x="480" y="230" width="120" height="50" rx="6" fill="#1a1a2e" stroke="#e94560" stroke-width="1.5" />
            <text x="540" y="252" text-anchor="middle" fill="#e94560" font-size="10" font-weight="600">Agent</text>
            <text x="540" y="268" text-anchor="middle" fill="#8892b0" font-size="9">agent-manager</text>

            <rect x="620" y="230" width="120" height="50" rx="6" fill="#1a1a2e" stroke="#e94560" stroke-width="1.5" />
            <text x="680" y="252" text-anchor="middle" fill="#e94560" font-size="10" font-weight="600">Agent</text>
            <text x="680" y="268" text-anchor="middle" fill="#8892b0" font-size="9">agent-manager</text>

            <!-- L0: Infrastructure -->
            <rect x="50" y="320" width="700" height="80" rx="8" fill="#0f3460" stroke="#8892b0" stroke-width="1" stroke-dasharray="4" />
            <text x="400" y="345" text-anchor="middle" fill="#8892b0" font-size="11" font-weight="600">L0: Infrastructure Layer</text>

            <rect x="80" y="355" width="130" height="34" rx="4" fill="#1a1a2e" stroke="#4ecdc4" stroke-width="1" />
            <text x="145" y="376" text-anchor="middle" fill="#4ecdc4" font-size="9">fractalbot</text>

            <rect x="230" y="355" width="130" height="34" rx="4" fill="#1a1a2e" stroke="#4ecdc4" stroke-width="1" />
            <text x="295" y="376" text-anchor="middle" fill="#4ecdc4" font-size="9">okr-manager</text>

            <rect x="380" y="355" width="130" height="34" rx="4" fill="#1a1a2e" stroke="#4ecdc4" stroke-width="1" />
            <text x="445" y="376" text-anchor="middle" fill="#4ecdc4" font-size="9">fractalmind-envd</text>

            <rect x="530" y="355" width="130" height="34" rx="4" fill="#1a1a2e" stroke="#4ecdc4" stroke-width="1" />
            <text x="595" y="376" text-anchor="middle" fill="#4ecdc4" font-size="9">explorer</text>
          </svg>
        </div>
        <div class="arch-cta">
          <a href="/architecture/overview" class="btn btn-secondary">Explore Architecture</a>
        </div>
      </div>
    </section>

    <!-- Live Demo -->
    <section id="public-surfaces" class="demo-section">
      <div class="section-container">
        <h2 class="section-title">Public Surfaces</h2>
        <p class="section-subtitle">Docs, GitHub, and Explorer show the public side of the system.</p>
        <div class="proof-grid">
          <a
            v-for="surface in proofSurfaces"
            :key="surface.title"
            :href="surface.link"
            class="proof-card"
            :target="surface.external ? '_blank' : undefined"
            :rel="surface.external ? 'noopener' : undefined"
          >
            <span class="proof-label">{{ surface.label }}</span>
            <h3>{{ surface.title }}</h3>
            <p>{{ surface.description }}</p>
            <span class="proof-cta">
              {{ surface.cta }}
              <span aria-hidden="true">&rarr;</span>
            </span>
          </a>
        </div>
        <div class="demo-card">
          <div class="demo-preview">
            <svg viewBox="0 0 600 300" fill="none" class="demo-svg">
              <rect width="600" height="300" rx="8" fill="#0f3460" />
              <pattern id="demo-dots" width="30" height="30" patternUnits="userSpaceOnUse">
                <circle cx="15" cy="15" r="0.8" fill="#4ecdc4" opacity="0.2" />
              </pattern>
              <rect width="600" height="300" fill="url(#demo-dots)" />

              <!-- Central org node -->
              <circle cx="300" cy="90" r="28" fill="#1a1a2e" stroke="#4DA2FF" stroke-width="2" />
              <text x="300" y="86" text-anchor="middle" fill="#4DA2FF" font-size="8" font-weight="600">SuLabs</text>
              <text x="300" y="98" text-anchor="middle" fill="#8892b0" font-size="7">Organization</text>

              <!-- Team nodes -->
              <circle cx="140" cy="180" r="22" fill="#1a1a2e" stroke="#4ecdc4" stroke-width="1.5" />
              <text x="140" y="177" text-anchor="middle" fill="#4ecdc4" font-size="7" font-weight="600">Infra</text>
              <text x="140" y="188" text-anchor="middle" fill="#8892b0" font-size="6">Team</text>

              <circle cx="300" cy="180" r="22" fill="#1a1a2e" stroke="#4ecdc4" stroke-width="1.5" />
              <text x="300" y="177" text-anchor="middle" fill="#4ecdc4" font-size="7" font-weight="600">Product</text>
              <text x="300" y="188" text-anchor="middle" fill="#8892b0" font-size="6">Team</text>

              <circle cx="460" cy="180" r="22" fill="#1a1a2e" stroke="#4ecdc4" stroke-width="1.5" />
              <text x="460" y="177" text-anchor="middle" fill="#4ecdc4" font-size="7" font-weight="600">QA</text>
              <text x="460" y="188" text-anchor="middle" fill="#8892b0" font-size="6">Team</text>

              <!-- Agent nodes -->
              <circle cx="90" cy="250" r="14" fill="#1a1a2e" stroke="#e94560" stroke-width="1" />
              <text x="90" y="253" text-anchor="middle" fill="#e94560" font-size="6">A1</text>
              <circle cx="190" cy="250" r="14" fill="#1a1a2e" stroke="#e94560" stroke-width="1" />
              <text x="190" y="253" text-anchor="middle" fill="#e94560" font-size="6">A2</text>
              <circle cx="260" cy="250" r="14" fill="#1a1a2e" stroke="#e94560" stroke-width="1" />
              <text x="260" y="253" text-anchor="middle" fill="#e94560" font-size="6">A3</text>
              <circle cx="340" cy="250" r="14" fill="#1a1a2e" stroke="#e94560" stroke-width="1" />
              <text x="340" y="253" text-anchor="middle" fill="#e94560" font-size="6">A4</text>
              <circle cx="420" cy="250" r="14" fill="#1a1a2e" stroke="#e94560" stroke-width="1" />
              <text x="420" y="253" text-anchor="middle" fill="#e94560" font-size="6">A5</text>
              <circle cx="500" cy="250" r="14" fill="#1a1a2e" stroke="#e94560" stroke-width="1" />
              <text x="500" y="253" text-anchor="middle" fill="#e94560" font-size="6">A6</text>

              <!-- Connection lines -->
              <line x1="280" y1="112" x2="155" y2="162" stroke="#4DA2FF" stroke-width="1" opacity="0.4" />
              <line x1="300" y1="118" x2="300" y2="158" stroke="#4DA2FF" stroke-width="1" opacity="0.4" />
              <line x1="320" y1="112" x2="445" y2="162" stroke="#4DA2FF" stroke-width="1" opacity="0.4" />
              <line x1="125" y1="198" x2="95" y2="238" stroke="#4ecdc4" stroke-width="1" opacity="0.3" />
              <line x1="155" y1="198" x2="185" y2="238" stroke="#4ecdc4" stroke-width="1" opacity="0.3" />
              <line x1="282" y1="198" x2="264" y2="238" stroke="#4ecdc4" stroke-width="1" opacity="0.3" />
              <line x1="318" y1="198" x2="336" y2="238" stroke="#4ecdc4" stroke-width="1" opacity="0.3" />
              <line x1="443" y1="198" x2="425" y2="238" stroke="#4ecdc4" stroke-width="1" opacity="0.3" />
              <line x1="477" y1="198" x2="495" y2="238" stroke="#4ecdc4" stroke-width="1" opacity="0.3" />

              <!-- Legend -->
              <circle cx="30" cy="20" r="6" fill="#1a1a2e" stroke="#4DA2FF" stroke-width="1" />
              <text x="42" y="23" fill="#8892b0" font-size="7">Organization</text>
              <circle cx="130" cy="20" r="6" fill="#1a1a2e" stroke="#4ecdc4" stroke-width="1" />
              <text x="142" y="23" fill="#8892b0" font-size="7">Team</text>
              <circle cx="200" cy="20" r="6" fill="#1a1a2e" stroke="#e94560" stroke-width="1" />
              <text x="212" y="23" fill="#8892b0" font-size="7">Agent</text>
            </svg>
          </div>
          <div class="demo-info">
            <h3>Explorer + Open Documentation</h3>
            <p>
              The explorer remains a public trust and visualization surface. It complements the
              docs, GitHub organization, and operating-system narrative by showing a verifiable
              public side of the stack.
            </p>
            <ul class="demo-features">
              <li>Interactive D3.js force-directed graph</li>
              <li>Real-time data from SUI Testnet</li>
              <li>Browse org hierarchy, agents, and tasks</li>
              <li>View on-chain certificates and governance</li>
            </ul>
            <a href="https://fractalmind-ai.github.io/explorer" class="btn btn-primary" target="_blank" rel="noopener">
              Launch Explorer
            </a>
          </div>
        </div>
      </div>
    </section>

    <!-- Trust & Transparency -->
    <section id="trust" class="trust-section">
      <div class="section-container">
        <div class="trust-header">
          <div class="stage-badge">OS v1.0</div>
          <h2 class="section-title">Trust &amp; Transparency</h2>
          <p class="section-subtitle">Open source, file-backed, and publicly inspectable.</p>
        </div>

        <div class="trust-grid">
          <!-- Milestones -->
          <div class="trust-card milestones-card">
            <h3>Milestones</h3>
            <div class="timeline">
              <div v-for="ms in milestones" :key="ms.title" class="timeline-item">
                <div class="timeline-dot"></div>
                <div class="timeline-content">
                  <span class="timeline-date">{{ ms.date }}</span>
                  <strong>{{ ms.title }}</strong>
                  <p>{{ ms.description }}</p>
                </div>
              </div>
            </div>
          </div>

          <!-- Verify -->
          <div class="trust-card verify-card">
            <h3>Verify It Yourself</h3>
            <div class="verify-links">
              <a
                v-for="link in githubLinks"
                :key="link.label"
                :href="link.url"
                class="verify-link"
                :target="link.external ? '_blank' : undefined"
                :rel="link.external ? 'noopener' : undefined"
              >
                <strong>{{ link.label }}</strong>
                <p>{{ link.description }}</p>
                <span class="verify-arrow">&rarr;</span>
              </a>
            </div>

            <div class="stage-info">
              <h4>Project Stage: OS-first documentation refresh</h4>
              <p>
                FractalMind is actively shifting from a protocol-first public story to the
                current OS-first reality: heartbeat, structured memory, candidate OKRs,
                governed execution, and observable outcomes. The protocol is still live on
                SUI Testnet — it is now one important surface inside a broader operating system.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- CTA Section -->
    <section id="next-step" class="cta-section">
      <div class="section-container">
        <div class="cta-shell">
          <div class="cta-copy">
            <div class="stage-badge">Next step</div>
            <h2>Start with the operating model</h2>
            <p>Get the framing first, then the workflow, then the component map. The protocol and explorer still matter — they just fit inside a broader operating system narrative now.</p>
            <ul class="cta-list">
              <li>Understand the OS-first model</li>
              <li>Open the practical quick-start path</li>
              <li>Inspect components and trust surfaces</li>
            </ul>
          </div>
          <div class="cta-actions-panel">
            <div class="cta-actions">
              <a href="/guide/what-is-fractalmind" class="btn btn-primary">
                What is FractalMind?
              </a>
              <a href="/guide/quick-start" class="btn btn-primary">
                Quick Start Guide
              </a>
              <a href="/components/overview" class="btn btn-secondary">
                Browse Components
              </a>
              <a href="https://github.com/fractalmind-ai" class="btn btn-ghost" target="_blank" rel="noopener">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
                </svg>
                View on GitHub
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- Footer -->
    <footer class="brand-footer">
      <div class="section-container">
        <div class="footer-grid">
          <div class="footer-brand">
            <div class="footer-logo">
              <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
                <path d="M16 4L28 26H4L16 4Z" fill="#4DA2FF" opacity="0.9" />
                <path d="M16 10L22 22H10L16 10Z" fill="#1a1a2e" />
                <path d="M16 14L19 20H13L16 14Z" fill="#4DA2FF" opacity="0.7" />
              </svg>
              <span>FractalMind AI</span>
            </div>
            <p class="footer-tagline">Governed autonomy for AI agent teams</p>
          </div>
          <div class="footer-links">
            <h4>Documentation</h4>
            <ul>
              <li><a href="/guide/what-is-fractalmind">What is FractalMind?</a></li>
              <li><a href="/guide/quick-start">Quick Start</a></li>
              <li><a href="/architecture/overview">Architecture</a></li>
              <li><a href="/protocol/overview">Protocol</a></li>
            </ul>
          </div>
          <div class="footer-links">
            <h4>Components</h4>
            <ul>
              <li><a href="/components/protocol">fractalmind-protocol</a></li>
              <li><a href="/components/fractalbot">fractalbot</a></li>
              <li><a href="/components/agent-manager">agent-manager</a></li>
              <li><a href="/components/team-manager">team-manager</a></li>
            </ul>
          </div>
          <div class="footer-links">
            <h4>Community</h4>
            <ul>
              <li>
                <a href="https://github.com/fractalmind-ai" target="_blank" rel="noopener">
                  GitHub Organization
                </a>
              </li>
              <li>
                <a href="https://fractalmind-ai.github.io/explorer" target="_blank" rel="noopener">
                  Explorer (Live Demo)
                </a>
              </li>
              <li>
                <a href="https://github.com/fractalmind-ai/fractalmind-ai.github.io" target="_blank" rel="noopener">
                  Docs Source
                </a>
              </li>
              <li><a href="/roadmap/">Roadmap</a></li>
            </ul>
          </div>
        </div>
        <div class="footer-bottom">
          <p>Released under the MIT License. Copyright &copy; 2026 FractalMind AI</p>
        </div>
      </div>
    </footer>
  </div>
</template>

<style scoped>
/* ===== Layout ===== */
.brand-home {
  --bg: #050507;
  --surface: #101010;
  --surface-alt: #151517;
  --surface-soft: #0b100f;
  --border: #3d3a39;
  --border-soft: rgba(184, 179, 176, 0.16);
  --accent: #00d992;
  --accent-soft: rgba(0, 217, 146, 0.12);
  --accent-blue: #4da2ff;
  --text: #f2f2f2;
  --muted: #b8b3b0;
  --subtle: #8b949e;
  --shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
  opacity: 0;
  transition: opacity 0.6s ease;
  background: var(--bg);
  color: var(--text);
}
.brand-home.visible {
  opacity: 1;
}
.section-container {
  max-width: 1200px;
  margin: 0 auto;
  padding: 0 24px;
}
.brand-home :is(section[id]) {
  scroll-margin-top: 88px;
}
.section-title {
  text-align: center;
  font-size: clamp(2rem, 4vw, 3rem);
  font-weight: 650;
  line-height: 1.04;
  letter-spacing: -0.04em;
  color: var(--text);
  margin-bottom: 12px;
}
.section-subtitle {
  max-width: 760px;
  margin: 0 auto 48px;
  text-align: center;
  color: var(--subtle);
  font-size: 1.05rem;
  line-height: 1.7;
}

/* ===== Hero ===== */
.hero-section {
  position: relative;
  overflow: hidden;
  background:
    radial-gradient(circle at top left, rgba(77, 162, 255, 0.12), transparent 32%),
    radial-gradient(circle at 80% 15%, rgba(0, 217, 146, 0.12), transparent 26%),
    linear-gradient(180deg, rgba(5, 5, 7, 0.96), rgba(7, 8, 10, 1));
  padding: 120px 0 72px;
}
.hero-bg {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.fractal-grid {
  position: absolute;
  inset: 0;
}
.fractal-triangle {
  position: absolute;
  color: var(--accent);
}
.ft-1 { width: 300px; top: 4%; left: 4%; animation: float 20s ease-in-out infinite; }
.ft-2 { width: 220px; top: 14%; right: 8%; color: var(--accent-blue); animation: float 25s ease-in-out infinite reverse; }
.ft-3 { width: 240px; bottom: 11%; left: 14%; color: rgba(0, 217, 146, 0.65); animation: float 22s ease-in-out infinite; }
.ft-4 { width: 180px; bottom: 18%; right: 6%; color: rgba(77, 162, 255, 0.7); animation: float 18s ease-in-out infinite reverse; }
.ft-5 { width: 150px; top: 50%; left: 52%; color: rgba(0, 217, 146, 0.4); animation: float 30s ease-in-out infinite; }
.ft-6 { width: 220px; top: 62%; right: 22%; color: rgba(77, 162, 255, 0.5); animation: float 24s ease-in-out infinite reverse; }
.hero-orb {
  position: absolute;
  border-radius: 999px;
  filter: blur(80px);
  opacity: 0.35;
}
.hero-orb-a {
  width: 260px;
  height: 260px;
  right: 8%;
  top: 10%;
  background: rgba(0, 217, 146, 0.22);
}
.hero-orb-b {
  width: 320px;
  height: 320px;
  left: -4%;
  bottom: -8%;
  background: rgba(77, 162, 255, 0.14);
}
@keyframes float {
  0%, 100% { transform: translateY(0) rotate(0deg); }
  33% { transform: translateY(-20px) rotate(2deg); }
  66% { transform: translateY(10px) rotate(-1deg); }
}
.hero-shell {
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-columns: minmax(0, 1.08fr) minmax(320px, 0.92fr);
  gap: 28px;
  align-items: stretch;
}
.hero-copy,
.hero-panel {
  position: relative;
  border-radius: 28px;
  border: 1px solid var(--border-soft);
  background: linear-gradient(180deg, rgba(16, 16, 16, 0.94), rgba(10, 10, 10, 0.98));
  box-shadow: var(--shadow);
}
.hero-copy {
  padding: 40px;
}
.hero-panel {
  padding: 28px;
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.hero-kicker-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 24px;
}
.hero-kicker,
.hero-inline-proof,
.panel-pill,
.hero-chip {
  display: inline-flex;
  align-items: center;
  min-height: 32px;
  border-radius: 999px;
  padding: 0 12px;
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}
.hero-kicker,
.panel-pill {
  color: var(--accent);
  background: rgba(0, 217, 146, 0.08);
  border: 1px solid rgba(0, 217, 146, 0.22);
}
.hero-inline-proof {
  color: var(--subtle);
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
}
.hero-logo {
  margin-bottom: 28px;
}
.hero-logo svg {
  filter: drop-shadow(0 0 18px rgba(0, 217, 146, 0.22));
}
.hero-title {
  margin-bottom: 18px;
}
.title-main {
  display: block;
  font-size: clamp(3.6rem, 9vw, 6rem);
  line-height: 0.96;
  letter-spacing: -0.065em;
  font-weight: 650;
  color: var(--text);
}
.title-sub {
  display: block;
  margin-top: 18px;
  max-width: 14ch;
  font-size: clamp(1.28rem, 2.8vw, 1.95rem);
  line-height: 1.08;
  letter-spacing: -0.04em;
  font-weight: 420;
  color: var(--muted);
}
.hero-description {
  max-width: 680px;
  margin: 0 0 32px;
  color: var(--subtle);
  font-size: 1.05rem;
  line-height: 1.75;
}
.hero-selling-points {
  display: grid;
  gap: 14px;
  margin-bottom: 32px;
}
.selling-point {
  display: grid;
  grid-template-columns: 20px 1fr;
  gap: 14px;
  align-items: start;
  padding: 16px 18px;
  border-radius: 18px;
  border: 1px solid rgba(255, 255, 255, 0.05);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.02), rgba(255, 255, 255, 0.01));
}
.sp-icon {
  font-size: 1rem;
  line-height: 1.4;
  color: var(--accent);
}
.selling-point strong {
  display: block;
  color: var(--text);
  font-size: 0.98rem;
  margin-bottom: 4px;
}
.selling-point p {
  color: var(--subtle);
  font-size: 0.93rem;
  line-height: 1.65;
  margin: 0;
}
.hero-actions {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}
.hero-paths {
  display: grid;
  gap: 16px;
  margin-top: 24px;
}
.hero-paths-header {
  display: grid;
  gap: 8px;
}
.hero-paths-header p {
  margin: 0;
  color: var(--subtle);
  font-size: 0.92rem;
  line-height: 1.65;
}
.hero-paths-eyebrow {
  display: inline-flex;
  align-items: center;
  width: fit-content;
  min-height: 28px;
  border-radius: 999px;
  padding: 0 12px;
  border: 1px solid rgba(77, 162, 255, 0.22);
  background: rgba(77, 162, 255, 0.08);
  color: var(--accent-blue);
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}
.hero-path-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
}
.hero-path-card {
  display: grid;
  gap: 10px;
  min-height: 100%;
  padding: 18px;
  border-radius: 20px;
  border: 1px solid rgba(255, 255, 255, 0.06);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.03), rgba(255, 255, 255, 0.015));
  text-decoration: none;
  transition: transform 0.2s ease, border-color 0.2s ease, background 0.2s ease, box-shadow 0.2s ease;
}
.hero-path-card:hover {
  transform: translateY(-2px);
  border-color: rgba(0, 217, 146, 0.24);
  background: linear-gradient(180deg, rgba(0, 217, 146, 0.08), rgba(77, 162, 255, 0.05));
  box-shadow: 0 18px 36px rgba(0, 0, 0, 0.18);
}
.hero-path-card strong {
  color: var(--text);
  font-size: 1rem;
  line-height: 1.4;
}
.hero-path-card p {
  margin: 0;
  color: var(--subtle);
  font-size: 0.92rem;
  line-height: 1.68;
}
.hero-path-audience,
.hero-path-proof,
.hero-path-cta {
  display: inline-flex;
  align-items: center;
}
.hero-path-audience {
  color: var(--accent);
  font-size: 0.76rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}
.hero-path-proof {
  color: var(--muted);
  font-size: 0.8rem;
  line-height: 1.5;
}
.hero-path-cta {
  margin-top: auto;
  color: var(--text);
  font-size: 0.9rem;
  font-weight: 600;
}
.section-nav {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 18px;
}
.section-nav-link {
  display: inline-flex;
  align-items: center;
  min-height: 40px;
  padding: 0 14px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.03);
  color: var(--muted);
  text-decoration: none;
  font-size: 0.82rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  transition: transform 0.2s ease, border-color 0.2s ease, color 0.2s ease, background 0.2s ease;
}
.section-nav-link:hover {
  transform: translateY(-1px);
  border-color: rgba(0, 217, 146, 0.26);
  color: var(--text);
  background: rgba(0, 217, 146, 0.08);
}
.section-nav-link.is-active {
  border-color: rgba(0, 217, 146, 0.38);
  color: var(--text);
  background: linear-gradient(180deg, rgba(0, 217, 146, 0.18), rgba(77, 162, 255, 0.12));
  box-shadow: 0 0 0 1px rgba(0, 217, 146, 0.1) inset;
}
.section-nav-link:focus-visible {
  outline: 2px solid rgba(0, 217, 146, 0.5);
  outline-offset: 2px;
  border-color: rgba(0, 217, 146, 0.32);
  color: var(--text);
}
.hero-panel-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.panel-status {
  color: var(--subtle);
  font-size: 0.82rem;
  letter-spacing: 0.03em;
}
.hero-command {
  padding: 18px;
  border-radius: 20px;
  border: 1px solid rgba(0, 217, 146, 0.18);
  background: linear-gradient(180deg, rgba(0, 217, 146, 0.08), rgba(16, 16, 16, 0.92));
}
.command-label {
  display: block;
  margin-bottom: 10px;
  color: var(--subtle);
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
}
.hero-command code {
  display: block;
  color: var(--text);
  font-size: 0.98rem;
  line-height: 1.7;
  font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
}
.hero-panel-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}
.panel-metric {
  padding: 18px;
  border-radius: 20px;
  border: 1px solid rgba(255, 255, 255, 0.05);
  background: rgba(255, 255, 255, 0.02);
}
.panel-metric-accent {
  border-color: rgba(0, 217, 146, 0.22);
  background: linear-gradient(180deg, rgba(0, 217, 146, 0.08), rgba(255, 255, 255, 0.02));
}
.panel-metric-wide {
  grid-column: 1 / -1;
}
.panel-metric-label {
  display: block;
  margin-bottom: 10px;
  color: var(--subtle);
  font-size: 0.7rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
}
.panel-metric strong {
  display: block;
  margin-bottom: 8px;
  color: var(--text);
  font-size: 1.02rem;
  line-height: 1.35;
}
.panel-metric p {
  margin: 0;
  color: var(--subtle);
  font-size: 0.9rem;
  line-height: 1.65;
}
.hero-chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
.hero-chip {
  color: var(--muted);
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
}

/* ===== Buttons ===== */
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 48px;
  padding: 12px 18px;
  border-radius: 12px;
  font-size: 0.96rem;
  font-weight: 600;
  text-decoration: none;
  transition: transform 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease, background 0.2s ease, color 0.2s ease;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text);
}
.btn:hover {
  transform: translateY(-2px);
}
.btn:focus-visible,
.start-card:focus-visible,
.product-card:focus-visible,
.verify-link:focus-visible,
.hero-path-card:focus-visible {
  outline: 2px solid rgba(0, 217, 146, 0.46);
  outline-offset: 3px;
}
.btn-primary {
  color: #2fd6a1;
  border-color: rgba(0, 217, 146, 0.28);
  background: linear-gradient(180deg, rgba(16, 16, 16, 0.96), rgba(11, 16, 15, 0.98));
  box-shadow: inset 0 0 0 1px rgba(0, 217, 146, 0.06);
}
.btn-primary:hover {
  box-shadow: 0 18px 36px rgba(0, 217, 146, 0.12);
  background: linear-gradient(180deg, rgba(13, 23, 20, 0.98), rgba(9, 14, 13, 1));
}
.btn-secondary {
  background: rgba(255, 255, 255, 0.01);
  color: var(--text);
  border-color: rgba(184, 179, 176, 0.18);
}
.btn-secondary:hover {
  border-color: rgba(0, 217, 146, 0.24);
  background: rgba(255, 255, 255, 0.03);
}
.btn-ghost {
  background: transparent;
  color: var(--subtle);
  border-color: rgba(184, 179, 176, 0.16);
}
.btn-ghost:hover {
  color: var(--text);
  border-color: rgba(255, 255, 255, 0.14);
  background: rgba(255, 255, 255, 0.02);
}

/* ===== Stats ===== */
.stats-section {
  background: var(--bg);
  padding: 0 0 88px;
  margin-top: -12px;
  position: relative;
  z-index: 2;
}
.stats-shell {
  display: grid;
  grid-template-columns: minmax(240px, 320px) 1fr;
  gap: 20px;
  padding: 28px;
  border-radius: 28px;
  border: 1px solid var(--border-soft);
  background: linear-gradient(180deg, rgba(16, 16, 16, 0.96), rgba(8, 8, 9, 0.98));
  box-shadow: var(--shadow);
}
.stats-intro {
  display: flex;
  flex-direction: column;
  justify-content: center;
}
.stats-eyebrow {
  color: var(--accent);
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.18em;
  margin-bottom: 14px;
}
.stats-intro h2 {
  color: var(--text);
  font-size: clamp(1.7rem, 3vw, 2.35rem);
  line-height: 1.02;
  letter-spacing: -0.05em;
  margin-bottom: 12px;
}
.stats-intro p {
  margin: 0;
  color: var(--subtle);
  line-height: 1.7;
}
.stats-container {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 14px;
}
.stat-item {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  min-height: 144px;
  padding: 18px;
  border-radius: 20px;
  border: 1px solid rgba(255, 255, 255, 0.05);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.025), rgba(255, 255, 255, 0.01));
}
.stat-value {
  display: block;
  font-size: clamp(1.45rem, 2.6vw, 2.35rem);
  line-height: 1;
  letter-spacing: -0.05em;
  font-weight: 650;
  color: var(--text);
}
.stat-label {
  display: block;
  margin-top: 18px;
  font-size: 0.82rem;
  color: var(--subtle);
  text-transform: uppercase;
  letter-spacing: 0.14em;
  line-height: 1.55;
}

/* ===== Start Here ===== */
.start-here-section {
  background: linear-gradient(180deg, rgba(16, 16, 16, 0.98), rgba(5, 5, 7, 1));
  padding: 88px 0;
  border-top: 1px solid rgba(184, 179, 176, 0.08);
  border-bottom: 1px solid rgba(184, 179, 176, 0.08);
}
.start-here-header {
  text-align: center;
  margin-bottom: 40px;
}
.start-here-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 20px;
}
.start-card {
  display: flex;
  flex-direction: column;
  min-height: 260px;
  padding: 26px;
  border-radius: 22px;
  text-decoration: none;
  background: linear-gradient(180deg, rgba(16, 16, 16, 0.96), rgba(11, 11, 12, 0.98));
  border: 1px solid var(--border-soft);
  transition: transform 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease, background 0.2s ease;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.28);
}
.start-card:hover {
  transform: translateY(-4px);
  border-color: rgba(0, 217, 146, 0.25);
  background: linear-gradient(180deg, rgba(16, 16, 16, 0.98), rgba(8, 14, 12, 0.98));
  box-shadow: 0 20px 48px rgba(0, 0, 0, 0.38);
}
.start-card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 24px;
}
.start-step {
  color: var(--accent);
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
}
.start-card-arrow {
  color: var(--subtle);
  font-size: 1.1rem;
}
.start-card h3 {
  color: var(--text);
  font-size: 1.2rem;
  line-height: 1.2;
  font-weight: 650;
  margin-bottom: 12px;
}
.start-card p {
  color: var(--subtle);
  line-height: 1.7;
  margin: 0 0 20px;
}
.start-card-link {
  margin-top: auto;
  color: #2fd6a1;
  font-size: 0.92rem;
  font-weight: 600;
}

/* ===== Problem / Solution ===== */
.problem-solution-section {
  background: #1a1a2e;
  padding: 80px 0;
}
.ps-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 32px;
}
.ps-card {
  padding: 32px;
  border-radius: 12px;
  border: 1px solid #2a2a4e;
  background: #16162a;
}
.ps-card h3 {
  font-size: 1.3rem;
  margin-bottom: 16px;
  font-weight: 700;
}
.ps-card p {
  color: #8892b0;
  line-height: 1.7;
  font-size: 1rem;
}
.ps-card.problem h3 { color: #e94560; }
.ps-card.solution h3 { color: #4ecdc4; }
.ps-card.solution strong { color: #e2e8f0; }

/* ===== Audience Fit ===== */
.audience-section {
  background: linear-gradient(180deg, rgba(10, 10, 14, 1), rgba(7, 9, 10, 1));
  padding: 80px 0 96px;
}
.audience-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 20px;
}
.audience-card {
  padding: 28px;
  border-radius: 22px;
  background: linear-gradient(180deg, rgba(16, 16, 16, 0.96), rgba(10, 10, 10, 0.98));
  border: 1px solid var(--border-soft);
  box-shadow: 0 14px 42px rgba(0, 0, 0, 0.26);
}
.audience-eyebrow {
  display: inline-flex;
  align-items: center;
  min-height: 30px;
  padding: 0 12px;
  border-radius: 999px;
  margin-bottom: 18px;
  color: var(--accent);
  background: rgba(0, 217, 146, 0.08);
  border: 1px solid rgba(0, 217, 146, 0.18);
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}
.audience-card h3 {
  margin-bottom: 12px;
  color: var(--text);
  font-size: 1.24rem;
  line-height: 1.2;
}
.audience-card p {
  margin-bottom: 18px;
  color: var(--subtle);
  line-height: 1.7;
}
.audience-points {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  gap: 12px;
}
.audience-points li {
  position: relative;
  padding-left: 18px;
  color: var(--muted);
  line-height: 1.55;
}
.audience-points li::before {
  content: '';
  position: absolute;
  left: 0;
  top: 10px;
  width: 7px;
  height: 7px;
  border-radius: 999px;
  background: var(--accent-blue);
  box-shadow: 0 0 0 4px rgba(77, 162, 255, 0.12);
}

/* ===== Products ===== */
.products-section {
  background: var(--bg);
  padding: 0 0 96px;
}
.products-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 20px;
}
.product-card {
  position: relative;
  display: flex;
  flex-direction: column;
  min-height: 280px;
  padding: 24px;
  border-radius: 22px;
  background: linear-gradient(180deg, rgba(16, 16, 16, 0.98), rgba(9, 9, 10, 0.98));
  border: 1px solid var(--border-soft);
  text-decoration: none;
  transition: transform 0.22s ease, border-color 0.22s ease, box-shadow 0.22s ease, background 0.22s ease;
  overflow: hidden;
  box-shadow: 0 14px 42px rgba(0, 0, 0, 0.3);
}
.product-card:hover {
  border-color: rgba(0, 217, 146, 0.24);
  transform: translateY(-4px);
  background: linear-gradient(180deg, rgba(16, 16, 16, 0.99), rgba(8, 13, 12, 0.98));
  box-shadow: 0 22px 48px rgba(0, 0, 0, 0.38);
}
.product-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  margin-bottom: 18px;
}
.product-tag {
  color: var(--subtle);
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}
.product-icon {
  width: 48px;
  height: 48px;
  display: grid;
  place-items: center;
  font-size: 1.4rem;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.05);
}
.product-name {
  font-size: 1.14rem;
  font-weight: 700;
  color: var(--text);
  margin-bottom: 10px;
  font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
}
.product-description {
  color: var(--subtle);
  font-size: 0.95rem;
  line-height: 1.7;
}
.product-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: auto;
  padding-top: 20px;
  color: #2fd6a1;
}
.product-link-label {
  font-size: 0.9rem;
  font-weight: 600;
}
.product-link-arrow {
  font-size: 1.1rem;
  transition: transform 0.2s ease;
}
.product-card:hover .product-link-arrow {
  transform: translateX(4px);
}
.product-accent {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 3px;
  opacity: 0.9;
}

/* ===== Architecture ===== */
.architecture-section {
  background: #1a1a2e;
  padding: 80px 0;
}
.arch-diagram {
  max-width: 800px;
  margin: 0 auto;
  border: 1px solid #2a2a4e;
  border-radius: 12px;
  overflow: hidden;
  background: #16162a;
}
.arch-svg {
  width: 100%;
  height: auto;
  display: block;
}
.arch-svg text {
  font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
}
.arch-cta {
  text-align: center;
  margin-top: 32px;
}

/* ===== Live Demo ===== */
.demo-section {
  background: #16162a;
  padding: 80px 0;
}
.proof-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 20px;
  margin-bottom: 28px;
}
.proof-card {
  display: flex;
  flex-direction: column;
  min-height: 232px;
  padding: 24px;
  border-radius: 18px;
  text-decoration: none;
  background: linear-gradient(180deg, rgba(20, 22, 34, 0.96), rgba(14, 16, 28, 0.98));
  border: 1px solid #2a2a4e;
  transition: transform 0.22s ease, border-color 0.22s ease, box-shadow 0.22s ease;
}
.proof-card:hover {
  transform: translateY(-4px);
  border-color: rgba(78, 205, 196, 0.4);
  box-shadow: 0 18px 44px rgba(0, 0, 0, 0.28);
}
.proof-label {
  display: inline-flex;
  align-items: center;
  width: fit-content;
  min-height: 28px;
  padding: 0 10px;
  border-radius: 999px;
  margin-bottom: 16px;
  color: #4ecdc4;
  background: rgba(78, 205, 196, 0.08);
  border: 1px solid rgba(78, 205, 196, 0.18);
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}
.proof-card h3 {
  margin-bottom: 10px;
  color: #e2e8f0;
  font-size: 1.12rem;
  line-height: 1.25;
}
.proof-card p {
  color: #8892b0;
  line-height: 1.65;
}
.proof-cta {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-top: auto;
  padding-top: 20px;
  color: #4DA2FF;
  font-weight: 600;
}
.demo-card {
  display: grid;
  grid-template-columns: 1.2fr 1fr;
  gap: 40px;
  align-items: center;
  background: #1a1a2e;
  border: 1px solid #2a2a4e;
  border-radius: 16px;
  overflow: hidden;
}
.demo-preview {
  background: #0f3460;
  padding: 24px;
}
.demo-svg {
  width: 100%;
  height: auto;
  display: block;
}
.demo-svg text {
  font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
}
.demo-info {
  padding: 32px 32px 32px 0;
}
.demo-info h3 {
  font-size: 1.4rem;
  font-weight: 700;
  color: #e2e8f0;
  margin-bottom: 12px;
}
.demo-info p {
  color: #8892b0;
  line-height: 1.7;
  margin-bottom: 20px;
}
.demo-features {
  list-style: none;
  padding: 0;
  margin: 0 0 24px;
}
.demo-features li {
  color: #8892b0;
  font-size: 0.95rem;
  padding: 4px 0;
  padding-left: 20px;
  position: relative;
}
.demo-features li::before {
  content: '';
  position: absolute;
  left: 0;
  top: 11px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #4ecdc4;
  opacity: 0.7;
}

/* ===== Trust & Transparency ===== */
.trust-section {
  background: #1a1a2e;
  padding: 80px 0;
  border-top: 1px solid #2a2a4e;
}
.trust-header {
  text-align: center;
  margin-bottom: 48px;
}
.stage-badge {
  display: inline-flex;
  align-items: center;
  min-height: 32px;
  padding: 0 14px;
  border-radius: 999px;
  background: rgba(0, 217, 146, 0.08);
  color: #2fd6a1;
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.16em;
  border: 1px solid rgba(0, 217, 146, 0.22);
  margin-bottom: 18px;
}
.trust-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 24px;
}
.trust-card {
  background: rgba(15, 52, 96, 0.2);
  border: 1px solid #2a2a4e;
  border-radius: 12px;
  padding: 32px;
}
.trust-card h3 {
  font-size: 1.2rem;
  color: #e2e8f0;
  margin-bottom: 24px;
  font-weight: 600;
}

/* Timeline */
.timeline {
  position: relative;
  padding-left: 24px;
}
.timeline::before {
  content: '';
  position: absolute;
  left: 5px;
  top: 4px;
  bottom: 4px;
  width: 2px;
  background: linear-gradient(to bottom, #4ecdc4, #e94560);
  border-radius: 1px;
}
.timeline-item {
  position: relative;
  margin-bottom: 20px;
}
.timeline-item:last-child {
  margin-bottom: 0;
}
.timeline-dot {
  position: absolute;
  left: -24px;
  top: 4px;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #4ecdc4;
  border: 2px solid #1a1a2e;
  box-shadow: 0 0 0 3px rgba(78, 205, 196, 0.2);
}
.timeline-content {
  padding-bottom: 4px;
}
.timeline-date {
  display: inline-block;
  font-size: 0.75rem;
  color: #4ecdc4;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-bottom: 4px;
}
.timeline-content strong {
  display: block;
  color: #e2e8f0;
  font-size: 0.95rem;
  margin-bottom: 4px;
}
.timeline-content p {
  color: #8892b0;
  font-size: 0.85rem;
  line-height: 1.5;
  margin: 0;
}

/* Verify card */
.verify-links {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 24px;
}
.verify-link {
  display: block;
  padding: 16px;
  background: rgba(26, 26, 46, 0.6);
  border: 1px solid #2a2a4e;
  border-radius: 8px;
  text-decoration: none;
  transition: all 0.2s ease;
  position: relative;
}
.verify-link:hover {
  border-color: #4ecdc4;
  background: rgba(78, 205, 196, 0.05);
  transform: translateX(4px);
}
.verify-link strong {
  color: #4DA2FF;
  font-size: 0.95rem;
  display: block;
  margin-bottom: 4px;
}
.verify-link p {
  color: #8892b0;
  font-size: 0.85rem;
  margin: 0;
  line-height: 1.4;
}
.verify-arrow {
  position: absolute;
  right: 16px;
  top: 50%;
  transform: translateY(-50%);
  color: #4ecdc4;
  font-size: 1.2rem;
  opacity: 0;
  transition: opacity 0.2s ease;
}
.verify-link:hover .verify-arrow {
  opacity: 1;
}

/* Stage info */
.stage-info {
  background: rgba(233, 69, 96, 0.08);
  border: 1px solid rgba(233, 69, 96, 0.2);
  border-radius: 8px;
  padding: 20px;
}
.stage-info h4 {
  color: #e94560;
  font-size: 0.9rem;
  font-weight: 700;
  margin-bottom: 8px;
}
.stage-info p {
  color: #8892b0;
  font-size: 0.85rem;
  line-height: 1.6;
  margin: 0;
}

/* ===== CTA ===== */
.cta-section {
  background: linear-gradient(180deg, rgba(5, 5, 7, 1), rgba(8, 13, 12, 1));
  padding: 20px 0 96px;
}
.cta-shell {
  display: grid;
  grid-template-columns: minmax(0, 1.08fr) minmax(280px, 0.92fr);
  gap: 24px;
  padding: 34px;
  border-radius: 28px;
  border: 1px solid var(--border-soft);
  background: linear-gradient(180deg, rgba(16, 16, 16, 0.98), rgba(9, 10, 10, 1));
  box-shadow: var(--shadow);
}
.cta-copy h2 {
  font-size: clamp(2rem, 4vw, 3rem);
  line-height: 1.02;
  letter-spacing: -0.05em;
  color: var(--text);
  margin-bottom: 14px;
}
.cta-copy p {
  color: var(--subtle);
  font-size: 1.02rem;
  line-height: 1.75;
  margin-bottom: 24px;
}
.cta-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  gap: 12px;
}
.cta-list li {
  position: relative;
  padding-left: 20px;
  color: var(--muted);
  line-height: 1.6;
}
.cta-list li::before {
  content: '';
  position: absolute;
  left: 0;
  top: 10px;
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: var(--accent);
  box-shadow: 0 0 0 4px rgba(0, 217, 146, 0.12);
}
.cta-actions-panel {
  display: flex;
  align-items: stretch;
}
.cta-actions {
  width: 100%;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  align-content: start;
}

/* ===== Footer ===== */
.brand-footer {
  background: #12121e;
  padding: 48px 0 0;
  border-top: 1px solid #2a2a4e;
}
.footer-grid {
  display: grid;
  grid-template-columns: 1.5fr 1fr 1fr 1fr;
  gap: 32px;
  padding-bottom: 40px;
}
.footer-brand {
  padding-right: 24px;
}
.footer-logo {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}
.footer-logo span {
  font-size: 1.1rem;
  font-weight: 700;
  color: #e2e8f0;
}
.footer-tagline {
  color: #8892b0;
  font-size: 0.9rem;
  line-height: 1.5;
}
.footer-links h4 {
  color: #e2e8f0;
  font-size: 0.85rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  margin-bottom: 16px;
}
.footer-links ul {
  list-style: none;
  padding: 0;
  margin: 0;
}
.footer-links li {
  margin-bottom: 10px;
}
.footer-links a {
  color: #8892b0;
  text-decoration: none;
  font-size: 0.9rem;
  transition: color 0.2s ease;
}
.footer-links a:hover {
  color: #4ecdc4;
}
.footer-bottom {
  border-top: 1px solid #2a2a4e;
  padding: 20px 0;
  text-align: center;
}
.footer-bottom p {
  color: #8892b066;
  font-size: 0.85rem;
}

@media (prefers-reduced-motion: reduce) {
  .brand-home *,
  .brand-home *::before,
  .brand-home *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }

  .feature-card:hover,
  .product-card:hover,
  .trust-card:hover,
  .section-nav-link:hover,
  .btn:hover,
  .panel-metric:hover,
  .start-card:hover,
  .ps-card:hover {
    transform: none;
  }
}

/* ===== Responsive ===== */
@media (max-width: 1024px) {
  .hero-shell,
  .stats-shell,
  .cta-shell {
    grid-template-columns: 1fr;
  }

  .hero-copy,
  .hero-panel,
  .cta-shell {
    padding: 28px;
  }

  .stats-container {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .hero-panel-grid {
    grid-template-columns: 1fr;
  }

  .hero-path-grid {
    grid-template-columns: 1fr;
  }

  .panel-metric-wide {
    grid-column: auto;
  }

  .products-grid,
  .proof-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .audience-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 768px) {
  .section-title {
    font-size: 2rem;
  }

  .section-subtitle {
    font-size: 1rem;
    margin-bottom: 36px;
  }

  .hero-section {
    padding: 104px 0 64px;
  }

  .hero-copy,
  .hero-panel,
  .stats-shell,
  .cta-shell,
  .trust-card {
    padding: 24px;
  }

  .title-main {
    font-size: 3rem;
  }

  .title-sub {
    max-width: none;
    font-size: 1.25rem;
  }

  .start-here-grid,
  .products-grid,
  .ps-grid,
  .trust-grid,
  .proof-grid,
  .demo-card {
    grid-template-columns: 1fr;
  }

  .stats-container {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .ft-1, .ft-2, .ft-3, .ft-4, .ft-5, .ft-6 {
    width: 110px;
  }

  .arch-diagram {
    overflow-x: auto;
  }

  .demo-info {
    padding: 24px;
  }

  .footer-grid {
    grid-template-columns: 1fr 1fr;
    gap: 24px;
  }

  .footer-brand {
    grid-column: 1 / -1;
    padding-right: 0;
  }
}

@media (max-width: 560px) {
  .section-container {
    padding: 0 18px;
  }

  .title-main {
    font-size: 2.45rem;
  }

  .title-sub {
    font-size: 1.08rem;
  }

  .hero-actions,
  .cta-actions {
    grid-template-columns: 1fr;
    display: grid;
  }

  .stats-container {
    grid-template-columns: 1fr;
  }

  .hero-panel-top,
  .hero-kicker-row,
  .hero-paths-header {
    flex-direction: column;
    align-items: flex-start;
  }

  .btn {
    width: 100%;
  }

  .footer-grid {
    grid-template-columns: 1fr;
  }
}
</style>
