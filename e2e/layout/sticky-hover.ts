// (g) A hover look a touch screen would leave stuck on. A phone keeps :hover
// on whatever was tapped last until something else is tapped, so a hover
// background stays painted after the finger lifts. Hover looks belong inside
// @media (hover: hover), where only a pointer that really hovers gets them.
// Unlike the other checks this reads the style rules the page loaded, since a
// stuck hover only shows after a tap the guard does not make.

import type { LayoutProblem } from './types'

/** A media condition that holds only for a pointer that hovers. */
const HOVERS = /\(\s*(any-)?hover\s*(:\s*hover\s*)?\)/

/** The rules of a style sheet, or none for one from another site the page may not read. */
function rulesOf(sheet: CSSStyleSheet): CSSRuleList | [] {
  try {
    return sheet.cssRules
  } catch {
    return []
  }
}

/** Selectors with :hover in `rules` that no hover-only media condition guards. */
function unguarded(rules: CSSRuleList | [], guarded: boolean): string[] {
  const found: string[] = []
  for (const rule of rules) {
    if (rule instanceof CSSMediaRule) {
      found.push(...unguarded(rule.cssRules, guarded || HOVERS.test(rule.conditionText)))
    } else if (rule instanceof CSSStyleRule) {
      if (!guarded && rule.selectorText.includes(':hover')) found.push(rule.selectorText)
      // Nested rules sit under their parent's guard.
      found.push(...unguarded(rule.cssRules, guarded))
    } else if ('cssRules' in rule) {
      // @supports, @layer and the like pass their guard straight through.
      found.push(...unguarded((rule as CSSGroupingRule).cssRules, guarded))
    }
  }
  return found
}

export function findStickyHovers(): LayoutProblem[] {
  const selectors = [...document.styleSheets].flatMap((sheet) => unguarded(rulesOf(sheet), false))
  return [...new Set(selectors)].map((selector) => ({
    check: 'sticky-hover',
    message: `${selector} changes its look on hover outside @media (hover: hover), so a tap leaves it stuck on a touch screen`,
  }))
}
