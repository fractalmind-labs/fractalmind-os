import DefaultTheme from 'vitepress/theme'
import type { Theme } from 'vitepress'
import BrandLayout from './BrandLayout.vue'
import './custom.css'

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('BrandLayout', BrandLayout)
  },
} satisfies Theme
