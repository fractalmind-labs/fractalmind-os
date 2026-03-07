import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'FractalMind AI',
  description: 'Organize AI Agents into Fractal Structures. Emerge Superintelligence.',
  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/logo.svg' }],
  ],

  themeConfig: {
    logo: '/logo.svg',
    siteTitle: 'FractalMind AI',

    nav: [
      {
        text: 'Docs',
        items: [
          { text: 'What is FractalMind?', link: '/guide/what-is-fractalmind' },
          { text: 'Quick Start', link: '/guide/quick-start' },
          { text: 'Core Principles', link: '/guide/principles' },
        ],
      },
      { text: 'Architecture', link: '/architecture/overview' },
      { text: 'Components', link: '/components/overview' },
      { text: 'Protocol', link: '/protocol/overview' },
      { text: 'Roadmap', link: '/roadmap/' },
      {
        text: 'Explorer',
        link: 'https://fractalmind-ai.github.io/explorer',
        target: '_blank',
      },
    ],

    sidebar: {
      '/guide/': [
        {
          text: 'Introduction',
          items: [
            { text: 'What is FractalMind?', link: '/guide/what-is-fractalmind' },
            { text: 'Core Principles', link: '/guide/principles' },
            { text: 'Quick Start', link: '/guide/quick-start' },
          ],
        },
        {
          text: 'Setup Guides',
          items: [
            { text: 'envd Quick Start', link: '/guide/envd-quickstart' },
          ],
        },
      ],
      '/architecture/': [
        {
          text: 'Architecture',
          items: [
            { text: 'Overview', link: '/architecture/overview' },
            { text: 'Fractal Model', link: '/architecture/fractal-model' },
            { text: 'Data Flow', link: '/architecture/data-flow' },
            { text: 'Design Decisions', link: '/architecture/design-decisions' },
          ],
        },
      ],
      '/components/': [
        {
          text: 'Components',
          items: [
            { text: 'Overview', link: '/components/overview' },
            { text: 'fractalmind-protocol', link: '/components/protocol' },
            { text: 'fractalmind-envd', link: '/components/envd' },
            { text: 'fractalbot', link: '/components/fractalbot' },
            { text: 'agent-manager', link: '/components/agent-manager' },
            { text: 'team-manager', link: '/components/team-manager' },
            { text: 'okr-manager', link: '/components/okr-manager' },
            { text: 'team-chat', link: '/components/team-chat' },
            { text: 'Tool Skills', link: '/components/tool-skills' },
            { text: 'Applications', link: '/components/applications' },
          ],
        },
      ],
      '/protocol/': [
        {
          text: 'Protocol',
          items: [
            { text: 'Overview', link: '/protocol/overview' },
            { text: 'TypeScript SDK', link: '/protocol/sdk' },
            { text: 'Testnet Deployment', link: '/protocol/testnet' },
          ],
        },
      ],
      '/roadmap/': [
        {
          text: 'Roadmap',
          items: [
            { text: 'Overview', link: '/roadmap/' },
          ],
        },
      ],
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/fractalmind-ai' },
    ],

    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright 2026 FractalMind AI',
    },

    search: {
      provider: 'local',
    },

    editLink: {
      pattern: 'https://github.com/fractalmind-ai/fractalmind-ai.github.io/edit/main/docs/:path',
      text: 'Edit this page on GitHub',
    },
  },
})
