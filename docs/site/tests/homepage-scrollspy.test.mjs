import test from 'node:test'
import assert from 'node:assert/strict'

import { resolveActiveSectionHref, collectSectionMeasurements } from '../docs/.vitepress/theme/utils/homepageScrollSpy.js'

test('returns the first section when scroll is near the top', () => {
  const active = resolveActiveSectionHref([
    { href: '#snapshot', top: 120 },
    { href: '#start-here', top: 560 },
    { href: '#fit', top: 980 },
  ], 0, 180)

  assert.equal(active, '#snapshot')
})

test('returns the deepest section already crossed by the viewport threshold', () => {
  const active = resolveActiveSectionHref([
    { href: '#snapshot', top: 120 },
    { href: '#start-here', top: 560 },
    { href: '#fit', top: 980 },
    { href: '#operating-surfaces', top: 1520 },
  ], 905, 180)

  assert.equal(active, '#fit')
})

test('falls back to the first section when there are no measurements', () => {
  const active = resolveActiveSectionHref([], 640, 180, '#snapshot')

  assert.equal(active, '#snapshot')
})

test('returns an empty measurements list without browser globals', () => {
  const measurements = collectSectionMeasurements([{ href: '#snapshot' }])

  assert.deepEqual(measurements, [])
})
