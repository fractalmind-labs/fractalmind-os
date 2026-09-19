import DefaultTheme from 'vitepress/theme'
import type { Theme } from 'vitepress'
import BrandLayout from './BrandLayout.vue'
import WhyFractalMind from './components/WhyFractalMind.vue'
import './custom.css'

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('BrandLayout', BrandLayout)
    app.component('WhyFractalMind', WhyFractalMind)
  },
} satisfies Theme
