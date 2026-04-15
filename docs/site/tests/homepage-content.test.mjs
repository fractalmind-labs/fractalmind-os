import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

import { decisionPaths } from '../docs/.vitepress/theme/utils/homepageContent.js'

test('decision paths expose three role-based hero entry points', () => {
  assert.equal(decisionPaths.length, 3)
  assert.deepEqual(
    decisionPaths.map((item) => item.audience),
    ['Operators & founders', 'Infra & platform builders', 'Protocol-curious teams'],
  )

  for (const item of decisionPaths) {
    assert.ok(item.title.length > 0)
    assert.ok(item.description.length > 0)
    assert.match(item.link, /^(#|\/|https?:\/\/)/)
    assert.ok(item.cta.length > 0)
    assert.ok(item.proof.length > 0)
  }
})

test('BrandHome hero renders the decision path grid', async () => {
  const __filename = fileURLToPath(import.meta.url)
  const __dirname = path.dirname(__filename)
  const brandHomePath = path.resolve(__dirname, '../docs/.vitepress/theme/components/BrandHome.vue')
  const source = await readFile(brandHomePath, 'utf8')

  assert.match(source, /v-for="path in decisionPaths"/)
  assert.match(source, /class="hero-path-grid"/)
  assert.match(source, /class="hero-path-card"/)
})
