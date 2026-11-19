// The two layout checks about surfaces (layout/spill.ts, layout/sticky-hover.ts),
// each proven on a page broken on purpose and on the same page fixed. The
// broken page is the one an owner's phone showed: two alerts in a tight card,
// the second tapped, its row's background painted past the card's edges so
// it looked like a second card laid over the first.

import { expect, test } from '@playwright/test'
import { fixture, found } from './layout-fixture'

test.use({ viewport: { width: 390, height: 844 } })

/** Two alert rows that reach `reach` px into a card padded `pad` px. */
const alerts = (pad: number, reach: number) =>
  `<section aria-label="Alerts" style="margin: 16px; padding: ${pad}px; background: #3b1d1d; border-radius: 16px">
    <a href="#a" class="row" style="display: block; margin: 0 -${reach}px; padding: 12px">Overdrawn by $142.10</a>
    <a href="#b" class="row" style="display: block; margin: 0 -${reach}px; padding: 12px">Charged 2 overdraft fees</a>
  </section>`

test.describe('spill', () => {
  test('finds a row reaching past the card it sits on', async ({ page }) => {
    await fixture(page, alerts(8, 12))
    expect(await found(page, 'spill')).toEqual([
      '<a.row> "Overdrawn by $142.10" reaches 4px past the left and 4px past the right edge of <section> "Alerts"',
      '<a.row> "Charged 2 overdraft fees" reaches 4px past the left and 4px past the right edge of <section> "Alerts"',
    ])
  })

  test('leaves alone a row that reaches only into the padding', async ({ page }) => {
    await fixture(page, alerts(16, 12))
    expect(await found(page, 'spill')).toEqual([])
  })

  test('leaves alone a row in a box that scrolls or paints nothing', async ({ page }) => {
    await fixture(
      page,
      `<div style="margin: 16px; overflow-x: auto; background: #222">
        <a href="#" style="display: block; width: 600px">A wide row that scrolls</a>
      </div>
      <div style="margin: 16px">
        <a href="#" style="display: block; margin: 0 -12px">A row on the bare page</a>
      </div>`,
    )
    expect(await found(page, 'spill')).toEqual([])
  })
})

test.describe('sticky-hover', () => {
  test('finds a hover look a tap would leave on', async ({ page }) => {
    await fixture(page, alerts(16, 12), '.row:hover { background: #333 }')
    expect(await found(page, 'sticky-hover')).toEqual([
      '.row:hover changes its look on hover outside @media (hover: hover), so a tap leaves it stuck on a touch screen',
    ])
  })

  test('finds one inside a media query that is not about hovering', async ({ page }) => {
    await fixture(
      page,
      alerts(16, 12),
      '@media (max-width: 820px) { .row:hover { background: #333 } }',
    )
    expect(await found(page, 'sticky-hover')).toHaveLength(1)
  })

  test('leaves alone hover looks for a pointer that hovers', async ({ page }) => {
    await fixture(
      page,
      alerts(16, 12),
      `@media (hover: hover) { .row:hover { background: #333 } }
       @media (any-hover: hover) and (min-width: 400px) { .row:hover { color: red } }
       .row:active { background: #333 }`,
    )
    expect(await found(page, 'sticky-hover')).toEqual([])
  })
})
