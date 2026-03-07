<script setup lang="ts">
import { ref, onMounted } from 'vue'

const products = [
  {
    name: 'fractalmind-protocol',
    description: 'SUI Move smart contracts for on-chain AI org identity, governance, and task management.',
    icon: '&#x26d3;',
    color: '#4DA2FF',
    link: '/components/protocol',
  },
  {
    name: 'fractalmind-envd',
    description: 'Decentralized agent remote management with WireGuard tunnels and SUI-based authorization.',
    icon: '&#x1f310;',
    color: '#4ecdc4',
    link: '/components/overview',
  },
  {
    name: 'fractalbot',
    description: 'Multi-channel messaging bridge — iMessage, Telegram, Slack, Discord, and Feishu in one gateway.',
    icon: '&#x1f4e1;',
    color: '#e94560',
    link: '/components/fractalbot',
  },
  {
    name: 'agent-manager',
    description: 'AI agent lifecycle management with tmux-based sessions, heartbeat monitoring, and auto-restart.',
    icon: '&#x1f916;',
    color: '#4ecdc4',
    link: '/components/agent-manager',
  },
  {
    name: 'team-manager',
    description: 'Multi-agent team orchestration with lead-based coordination and workflow definitions.',
    icon: '&#x1f465;',
    color: '#4DA2FF',
    link: '/components/team-manager',
  },
  {
    name: 'okr-manager',
    description: 'Goal tracking for AI teams — objectives, key results, quality gates, and progress monitoring.',
    icon: '&#x1f3af;',
    color: '#e94560',
    link: '/components/okr-manager',
  },
  {
    name: 'explorer',
    description: 'On-chain organization visualization with D3.js — browse orgs, agents, and tasks on SUI.',
    icon: '&#x1f50d;',
    color: '#4ecdc4',
    link: 'https://fractalmind-ai.github.io/explorer',
  },
]

const stats = [
  { value: '12+', label: 'AI Agents' },
  { value: '6', label: 'Active Teams' },
  { value: '7', label: 'Core Components' },
  { value: 'Live', label: 'SUI Testnet' },
]

const visible = ref(false)
onMounted(() => {
  visible.value = true
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
      </div>
      <div class="hero-content">
        <div class="hero-logo">
          <svg width="80" height="80" viewBox="0 0 32 32" fill="none">
            <path d="M16 4L28 26H4L16 4Z" fill="#4DA2FF" opacity="0.9" />
            <path d="M16 10L22 22H10L16 10Z" fill="#1a1a2e" />
            <path d="M16 14L19 20H13L16 14Z" fill="#4DA2FF" opacity="0.7" />
          </svg>
        </div>
        <h1 class="hero-title">
          <span class="title-main">FractalMind AI</span>
          <span class="title-sub">The First On-Chain AI Organization</span>
        </h1>
        <p class="hero-tagline">Fractal Intelligence, On-Chain Governance</p>
        <p class="hero-description">
          Building the infrastructure for autonomous AI organizations
          that operate transparently on blockchain.
        </p>
        <div class="hero-actions">
          <a href="/guide/quick-start" class="btn btn-primary">Get Started</a>
          <a href="/architecture/overview" class="btn btn-secondary">Architecture</a>
          <a href="https://github.com/fractalmind-ai" class="btn btn-ghost" target="_blank" rel="noopener">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
            </svg>
            GitHub
          </a>
        </div>
      </div>
    </section>

    <!-- Stats Bar -->
    <section class="stats-section">
      <div class="stats-container">
        <div v-for="stat in stats" :key="stat.label" class="stat-item">
          <span class="stat-value">{{ stat.value }}</span>
          <span class="stat-label">{{ stat.label }}</span>
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
              AI agent systems today are opaque, centralized, and fragile. There's no standard
              way to verify agent identity, coordinate multi-agent teams, or govern autonomous
              operations transparently. As organizations deploy more AI agents, they need
              infrastructure that scales without sacrificing trust.
            </p>
          </div>
          <div class="ps-card solution">
            <h3>The Solution</h3>
            <p>
              FractalMind uses <strong>fractal architecture</strong> — the same self-similar
              pattern at every level — combined with <strong>on-chain governance on SUI</strong>.
              Agent identity, team structure, task assignment, and organizational hierarchy all
              live on-chain. The only AI management system where governance is fully
              permissionless and auditable.
            </p>
          </div>
        </div>
      </div>
    </section>

    <!-- Product Matrix -->
    <section class="products-section">
      <div class="section-container">
        <h2 class="section-title">Core Components</h2>
        <p class="section-subtitle">Seven composable modules — install only what you need</p>
        <div class="products-grid">
          <a
            v-for="product in products"
            :key="product.name"
            :href="product.link"
            class="product-card"
          >
            <div class="product-icon" :style="{ color: product.color }">
              <span v-html="product.icon"></span>
            </div>
            <h3 class="product-name">{{ product.name }}</h3>
            <p class="product-description">{{ product.description }}</p>
            <div class="product-accent" :style="{ backgroundColor: product.color }"></div>
          </a>
        </div>
      </div>
    </section>

    <!-- Architecture Diagram -->
    <section class="architecture-section">
      <div class="section-container">
        <h2 class="section-title">Fractal Architecture</h2>
        <p class="section-subtitle">Self-similar patterns at every layer</p>
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
    <section class="demo-section">
      <div class="section-container">
        <h2 class="section-title">Live Demo</h2>
        <p class="section-subtitle">Browse the FractalMind organization on SUI Testnet</p>
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
            <h3>On-Chain Organization Explorer</h3>
            <p>
              Visualize the full FractalMind organization hierarchy on SUI Testnet.
              Browse teams, agents, tasks, and governance structures — all
              read directly from the blockchain.
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

    <!-- CTA Section -->
    <section class="cta-section">
      <div class="section-container">
        <div class="cta-content">
          <h2>Ready to build?</h2>
          <p>Dive into the documentation or explore the source code on GitHub.</p>
          <div class="cta-actions">
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
            <p class="footer-tagline">Fractal Intelligence, On-Chain Governance</p>
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
  opacity: 0;
  transition: opacity 0.6s ease;
}
.brand-home.visible {
  opacity: 1;
}
.section-container {
  max-width: 1152px;
  margin: 0 auto;
  padding: 0 24px;
}
.section-title {
  text-align: center;
  font-size: 2rem;
  font-weight: 700;
  color: #e2e8f0;
  margin-bottom: 8px;
}
.section-subtitle {
  text-align: center;
  color: #8892b0;
  font-size: 1.1rem;
  margin-bottom: 48px;
}

/* ===== Hero ===== */
.hero-section {
  position: relative;
  min-height: 90vh;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  background: #1a1a2e;
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
  color: #4ecdc4;
}
.ft-1 { width: 300px; top: 5%; left: 5%; animation: float 20s ease-in-out infinite; }
.ft-2 { width: 200px; top: 15%; right: 10%; color: #4DA2FF; animation: float 25s ease-in-out infinite reverse; }
.ft-3 { width: 250px; bottom: 10%; left: 15%; color: #e94560; animation: float 22s ease-in-out infinite; }
.ft-4 { width: 180px; bottom: 20%; right: 5%; animation: float 18s ease-in-out infinite reverse; }
.ft-5 { width: 150px; top: 50%; left: 50%; color: #4DA2FF; animation: float 30s ease-in-out infinite; }
.ft-6 { width: 220px; top: 60%; right: 25%; color: #e94560; animation: float 24s ease-in-out infinite reverse; }

@keyframes float {
  0%, 100% { transform: translateY(0) rotate(0deg); }
  33% { transform: translateY(-20px) rotate(2deg); }
  66% { transform: translateY(10px) rotate(-1deg); }
}

.hero-content {
  position: relative;
  text-align: center;
  padding: 40px 24px;
  z-index: 1;
}
.hero-logo {
  margin-bottom: 24px;
}
.hero-logo svg {
  filter: drop-shadow(0 0 30px rgba(77, 162, 255, 0.3));
}
.hero-title {
  margin-bottom: 16px;
}
.title-main {
  display: block;
  font-size: 3.5rem;
  font-weight: 800;
  background: linear-gradient(135deg, #4DA2FF, #4ecdc4);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  line-height: 1.1;
}
.title-sub {
  display: block;
  font-size: 1.5rem;
  font-weight: 400;
  color: #e2e8f0;
  margin-top: 12px;
}
.hero-tagline {
  font-size: 1.2rem;
  color: #4ecdc4;
  font-weight: 500;
  letter-spacing: 0.05em;
  margin-bottom: 16px;
}
.hero-description {
  max-width: 600px;
  margin: 0 auto 32px;
  color: #8892b0;
  font-size: 1.1rem;
  line-height: 1.6;
}
.hero-actions {
  display: flex;
  gap: 12px;
  justify-content: center;
  flex-wrap: wrap;
}

/* ===== Buttons ===== */
.btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 12px 24px;
  border-radius: 8px;
  font-size: 1rem;
  font-weight: 600;
  text-decoration: none;
  transition: all 0.2s ease;
  border: 1px solid transparent;
}
.btn-primary {
  background: linear-gradient(135deg, #e94560, #c73a54);
  color: #fff;
}
.btn-primary:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(233, 69, 96, 0.3);
}
.btn-secondary {
  background: transparent;
  color: #4ecdc4;
  border-color: #4ecdc4;
}
.btn-secondary:hover {
  background: rgba(78, 205, 196, 0.1);
  transform: translateY(-2px);
}
.btn-ghost {
  background: transparent;
  color: #8892b0;
  border-color: #8892b033;
}
.btn-ghost:hover {
  color: #e2e8f0;
  border-color: #e2e8f0;
}

/* ===== Stats ===== */
.stats-section {
  background: #0f3460;
  padding: 32px 24px;
}
.stats-container {
  max-width: 900px;
  margin: 0 auto;
  display: flex;
  justify-content: space-around;
  flex-wrap: wrap;
  gap: 24px;
}
.stat-item {
  text-align: center;
}
.stat-value {
  display: block;
  font-size: 2.2rem;
  font-weight: 800;
  color: #4ecdc4;
}
.stat-label {
  display: block;
  font-size: 0.9rem;
  color: #8892b0;
  margin-top: 4px;
  text-transform: uppercase;
  letter-spacing: 0.1em;
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

/* ===== Products ===== */
.products-section {
  background: #16162a;
  padding: 80px 0;
}
.products-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 24px;
}
.product-card {
  position: relative;
  padding: 28px;
  border-radius: 12px;
  background: #1a1a2e;
  border: 1px solid #2a2a4e;
  text-decoration: none;
  transition: all 0.25s ease;
  overflow: hidden;
}
.product-card:hover {
  border-color: #4ecdc444;
  transform: translateY(-4px);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.3);
}
.product-icon {
  font-size: 2rem;
  margin-bottom: 16px;
}
.product-name {
  font-size: 1.1rem;
  font-weight: 700;
  color: #e2e8f0;
  margin-bottom: 8px;
  font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
}
.product-description {
  color: #8892b0;
  font-size: 0.95rem;
  line-height: 1.6;
}
.product-accent {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 3px;
  opacity: 0;
  transition: opacity 0.25s ease;
}
.product-card:hover .product-accent {
  opacity: 1;
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

/* ===== CTA ===== */
.cta-section {
  background: linear-gradient(135deg, #0f3460, #1a1a2e);
  padding: 80px 0;
}
.cta-content {
  text-align: center;
}
.cta-content h2 {
  font-size: 2rem;
  color: #e2e8f0;
  margin-bottom: 12px;
}
.cta-content p {
  color: #8892b0;
  font-size: 1.1rem;
  margin-bottom: 32px;
}
.cta-actions {
  display: flex;
  gap: 12px;
  justify-content: center;
  flex-wrap: wrap;
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

/* ===== Responsive ===== */
@media (max-width: 768px) {
  .title-main {
    font-size: 2.4rem;
  }
  .title-sub {
    font-size: 1.1rem;
  }
  .ps-grid {
    grid-template-columns: 1fr;
  }
  .products-grid {
    grid-template-columns: 1fr;
  }
  .stats-container {
    gap: 16px;
  }
  .stat-value {
    font-size: 1.6rem;
  }
  .hero-section {
    min-height: 80vh;
  }
  .ft-1, .ft-2, .ft-3, .ft-4, .ft-5, .ft-6 {
    width: 100px;
  }
  .arch-diagram {
    overflow-x: auto;
  }
  .demo-card {
    grid-template-columns: 1fr;
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

@media (max-width: 480px) {
  .title-main {
    font-size: 2rem;
  }
  .hero-actions {
    flex-direction: column;
    align-items: center;
  }
  .cta-actions {
    flex-direction: column;
    align-items: center;
  }
  .btn {
    width: 100%;
    justify-content: center;
    max-width: 280px;
  }
  .footer-grid {
    grid-template-columns: 1fr;
  }
}
</style>
