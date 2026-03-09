<script setup lang="ts">
import { ref, onMounted } from 'vue'

const useCases = [
  {
    icon: '&#x1f4bb;',
    color: '#4DA2FF',
    title: 'Multi-Agent Software Team',
    description: 'Run a full dev + QA pipeline with AI agents. A coordinator assigns tasks via OKRs, developer agents write code and open PRs, QA agents review and test — all managed through structured workflows.',
    metric: '12 agents shipping code across 6 teams',
    details: [
      'Lead-based coordination with automatic task routing',
      'OKR-driven goal tracking with quality gates',
      'Automated PR review pipeline with agent handoffs',
    ],
  },
  {
    icon: '&#x1f310;',
    color: '#4ecdc4',
    title: 'Remote Agent Management',
    description: 'Manage AI agents running on any machine — home servers, cloud VMs, edge devices — without a central server. envd uses WireGuard P2P tunnels and SUI blockchain for identity, so no vendor can cut your access.',
    metric: '~$0.14/month for 2 nodes vs $50+ for TeamViewer',
    details: [
      'P2P connectivity via WireGuard (no central relay)',
      'SUI blockchain for identity and peer discovery',
      'Auto-restart crashed agents within 60 seconds',
    ],
  },
  {
    icon: '&#x26a1;',
    color: '#e94560',
    title: 'Dynamic Resource Optimization',
    description: 'The turbo-frequency system monitors agent workload and adjusts polling rates automatically. When agents are idle, polling slows down. When tasks spike, it ramps up — keeping costs low without sacrificing responsiveness.',
    metric: '80% reduction in API costs during idle periods',
    details: [
      'Adaptive polling: 5s when active, 60s when idle',
      'Heartbeat-driven workload detection',
      'Per-agent and per-team frequency tuning',
    ],
  },
  {
    icon: '&#x1f91d;',
    color: '#4DA2FF',
    title: 'Community-Driven Development',
    description: 'AI agents participate in your open-source community — reviewing external PRs, answering GitHub Discussions, triaging issues, and maintaining documentation. Human maintainers set goals, agents do the legwork.',
    metric: 'Autonomous PR review and issue triage',
    details: [
      'Agents review PRs with code-level feedback',
      'Multi-channel routing via fractalbot (GitHub, Slack, Telegram)',
      'Human-in-the-loop approval for merge decisions',
    ],
  },
  {
    icon: '&#x1f300;',
    color: '#4ecdc4',
    title: 'Fractal Organization Scaling',
    description: 'The same management pattern works at every level: an agent manages tasks, a team manages agents, an organization manages teams. Nest teams within teams for departments, divisions, or cross-org federations — up to 8 levels deep.',
    metric: 'L0 agent → L1 team → L2 org — same pattern at every level',
    details: [
      'Self-similar structure from agent to federation',
      'On-chain governance at every level via SUI',
      'Max depth of 8 levels with consistent interfaces',
    ],
  },
]

const visible = ref(false)
onMounted(() => {
  visible.value = true
})
</script>

<template>
  <div class="why-page" :class="{ visible }">
    <!-- Header -->
    <section class="why-header">
      <div class="header-bg">
        <svg
          v-for="i in 4"
          :key="i"
          class="bg-triangle"
          :class="`bt-${i}`"
          viewBox="0 0 100 100"
          fill="none"
        >
          <path d="M50 10L90 80H10L50 10Z" stroke="currentColor" stroke-width="1" opacity="0.12" />
          <path d="M50 30L70 70H30L50 30Z" stroke="currentColor" stroke-width="1" opacity="0.08" />
        </svg>
      </div>
      <div class="section-container">
        <h1 class="page-title">Why FractalMind?</h1>
        <p class="page-subtitle">
          Real-world use cases for organizing AI agents into structured,
          collaborative teams — from solo projects to enterprise deployments.
        </p>
      </div>
    </section>

    <!-- Use Cases -->
    <section class="use-cases-section">
      <div class="section-container">
        <div
          v-for="(uc, index) in useCases"
          :key="uc.title"
          class="use-case"
          :class="{ reversed: index % 2 === 1 }"
        >
          <div class="uc-visual">
            <div class="uc-icon-wrapper" :style="{ borderColor: uc.color }">
              <span class="uc-icon" v-html="uc.icon"></span>
            </div>
            <div class="uc-metric" :style="{ color: uc.color }">{{ uc.metric }}</div>
          </div>
          <div class="uc-content">
            <h2 :style="{ color: uc.color }">{{ uc.title }}</h2>
            <p class="uc-description">{{ uc.description }}</p>
            <ul class="uc-details">
              <li v-for="detail in uc.details" :key="detail">
                <span class="detail-dot" :style="{ backgroundColor: uc.color }"></span>
                {{ detail }}
              </li>
            </ul>
          </div>
        </div>
      </div>
    </section>

    <!-- CTA -->
    <section class="why-cta">
      <div class="section-container">
        <div class="cta-content">
          <h2>Ready to try it?</h2>
          <p>Get a working agent team running in under 5 minutes.</p>
          <div class="cta-actions">
            <a href="/guide/quick-start" class="btn btn-primary">Quick Start</a>
            <a href="https://fractalmind-ai.github.io/explorer" class="btn btn-secondary" target="_blank" rel="noopener">Live Explorer</a>
            <a href="/architecture/overview" class="btn btn-ghost">Architecture</a>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.why-page {
  opacity: 0;
  transition: opacity 0.6s ease;
  font-family: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
  color: #e2e8f0;
  -webkit-font-smoothing: antialiased;
}
.why-page.visible {
  opacity: 1;
}
.section-container {
  max-width: 1024px;
  margin: 0 auto;
  padding: 0 24px;
}

/* ===== Header ===== */
.why-header {
  position: relative;
  background: #1a1a2e;
  padding: 100px 0 64px;
  overflow: hidden;
  text-align: center;
}
.header-bg {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.bg-triangle {
  position: absolute;
  color: #4ecdc4;
}
.bt-1 { width: 220px; top: -5%; left: 0; animation: float 22s ease-in-out infinite; }
.bt-2 { width: 180px; top: 10%; right: 5%; color: #4DA2FF; animation: float 26s ease-in-out infinite reverse; }
.bt-3 { width: 160px; bottom: -10%; left: 20%; color: #e94560; animation: float 20s ease-in-out infinite; }
.bt-4 { width: 140px; bottom: 5%; right: 15%; animation: float 24s ease-in-out infinite reverse; }

@keyframes float {
  0%, 100% { transform: translateY(0) rotate(0deg); }
  33% { transform: translateY(-20px) rotate(2deg); }
  66% { transform: translateY(10px) rotate(-1deg); }
}

.page-title {
  position: relative;
  font-size: 2.8rem;
  font-weight: 800;
  background: linear-gradient(135deg, #4DA2FF, #4ecdc4);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  margin-bottom: 16px;
}
.page-subtitle {
  position: relative;
  max-width: 600px;
  margin: 0 auto;
  color: #8892b0;
  font-size: 1.15rem;
  line-height: 1.6;
}

/* ===== Use Cases ===== */
.use-cases-section {
  background: #16162a;
  padding: 80px 0;
}
.use-case {
  display: grid;
  grid-template-columns: 280px 1fr;
  gap: 48px;
  align-items: start;
  padding: 48px 0;
  border-bottom: 1px solid #2a2a4e;
}
.use-case:last-child {
  border-bottom: none;
}
.use-case.reversed {
  grid-template-columns: 1fr 280px;
}
.use-case.reversed .uc-visual {
  order: 2;
}
.use-case.reversed .uc-content {
  order: 1;
}

.uc-visual {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
}
.uc-icon-wrapper {
  width: 100px;
  height: 100px;
  border-radius: 20px;
  border: 2px solid;
  background: #1a1a2e;
  display: flex;
  align-items: center;
  justify-content: center;
}
.uc-icon {
  font-size: 2.5rem;
}
.uc-metric {
  font-size: 0.85rem;
  font-weight: 600;
  text-align: center;
  line-height: 1.4;
  max-width: 220px;
}

.uc-content h2 {
  font-size: 1.5rem;
  font-weight: 700;
  margin-bottom: 12px;
}
.uc-description {
  color: #8892b0;
  font-size: 1.05rem;
  line-height: 1.7;
  margin-bottom: 20px;
}
.uc-details {
  list-style: none;
  padding: 0;
  margin: 0;
}
.uc-details li {
  display: flex;
  align-items: center;
  gap: 10px;
  color: #a0aec0;
  font-size: 0.95rem;
  padding: 5px 0;
}
.detail-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
  opacity: 0.7;
}

/* ===== CTA ===== */
.why-cta {
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

/* ===== Buttons (shared with BrandHome) ===== */
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

/* ===== Responsive ===== */
@media (max-width: 768px) {
  .page-title {
    font-size: 2rem;
  }
  .use-case,
  .use-case.reversed {
    grid-template-columns: 1fr;
    gap: 24px;
    padding: 32px 0;
  }
  .use-case.reversed .uc-visual {
    order: 0;
  }
  .use-case.reversed .uc-content {
    order: 0;
  }
  .uc-visual {
    flex-direction: row;
    justify-content: flex-start;
  }
  .uc-icon-wrapper {
    width: 64px;
    height: 64px;
    border-radius: 14px;
  }
  .uc-icon {
    font-size: 1.6rem;
  }
  .uc-metric {
    text-align: left;
    font-size: 0.8rem;
  }
}

@media (max-width: 480px) {
  .why-header {
    padding: 80px 0 48px;
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
}
</style>
