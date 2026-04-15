export function resolveActiveSectionHref(sections, scrollY = 0, offset = 180, fallbackHref = sections[0]?.href ?? '') {
  if (!Array.isArray(sections) || sections.length === 0) {
    return fallbackHref
  }

  const threshold = scrollY + offset
  let activeHref = sections[0]?.href ?? fallbackHref

  for (const section of sections) {
    if (!section?.href || typeof section.top !== 'number') {
      continue
    }

    if (section.top <= threshold) {
      activeHref = section.href
      continue
    }

    break
  }

  return activeHref || fallbackHref
}

export function collectSectionMeasurements(items, root, scrollY) {
  if (!Array.isArray(items) || items.length === 0) {
    return []
  }

  const resolvedRoot = root ?? (typeof document !== 'undefined' ? document : null)
  if (!resolvedRoot || typeof resolvedRoot.getElementById !== 'function') {
    return []
  }

  const resolvedScrollY = typeof scrollY === 'number'
    ? scrollY
    : (typeof window !== 'undefined' ? window.scrollY || window.pageYOffset || 0 : 0)

  return items
    .map((item) => {
      const id = item?.href?.startsWith('#') ? item.href.slice(1) : ''
      if (!id) {
        return null
      }

      const element = resolvedRoot.getElementById(id)
      if (!element) {
        return null
      }

      return {
        href: item.href,
        top: element.getBoundingClientRect().top + resolvedScrollY,
      }
    })
    .filter(Boolean)
    .sort((left, right) => left.top - right.top)
}
