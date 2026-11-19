// The layout guard's tap check (layout/taps.ts): a control a finger's 44px
// tap can miss, because it is drawn too small, placed off the page or covered
// by a neighbour, each proven on a small page broken on purpose and on the
// same page fixed.

import { expect, test, type Page } from '@playwright/test'
import { layoutProblems, missedTaps } from './layout'
import { fixture } from './layout-fixture'

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

/** What the tap check finds, without each control's size, for text whose size the font decides. */
const missedWithoutSize = async (page: Page) =>
  (await missedTaps(page)).map((message) => message.replace(/ \(\d+x\d+\)$/, ''))

/** A round dot drawn 28px across, as a colour swatch or a theme dot is. */
const DOT = `
  .dot { width: 28px; height: 28px; padding: 0; border: 0; border-radius: 50%; background: teal; }
  .wide-tap { position: relative; }
  .wide-tap::before {
    content: ''; position: absolute; top: 50%; left: 50%;
    width: 44px; height: 44px; transform: translate(-50%, -50%);
  }`

test.describe('a control drawn too small', () => {
  test('finds a button 30px tall, and passes it at 44px', async ({ page }) => {
    await fixture(page, `<button style="width: 120px; height: 30px">Save</button>`)
    expect(await missedTaps(page)).toEqual(['<button> "Save" misses a 44px tap (120x30)'])

    await fixture(page, `<button style="width: 120px; height: 44px">Save</button>`)
    expect(await missedTaps(page)).toEqual([])
  })

  test('finds a button 40px tall, as the app drew its buttons before', async ({ page }) => {
    await fixture(page, `<button style="width: 120px; height: 40px">Save</button>`)
    expect(await missedTaps(page)).toEqual(['<button> "Save" misses a 44px tap (120x40)'])
  })

  // Hit testing snaps a box to whole pixels, so each size is tried at every
  // sixteenth of a pixel off the grid, as a box laid out after text often sits.
  const OFFSETS = Array.from({ length: 16 }, (_, i) => i / 16)
  const square = (size: number, offset: number) =>
    `<button style="margin: ${offset}px 0 0 ${offset}px; width: ${size}px; height: ${size}px; padding: 0">+</button>`

  test('passes a control exactly 44px square, wherever it sits between pixels', async ({
    page,
  }) => {
    for (const offset of OFFSETS) {
      await fixture(page, square(44, offset))
      expect(await missedTaps(page), `${offset}px off the pixel grid`).toEqual([])
    }
  })

  for (const size of [43, 42]) {
    test(`finds a control ${size}px square, wherever it sits between pixels`, async ({ page }) => {
      for (const offset of OFFSETS) {
        await fixture(page, square(size, offset))
        expect(await missedTaps(page), `${offset}px off the pixel grid`).toEqual([
          `<button> "+" misses a 44px tap (${size}x${size})`,
        ])
      }
    })
  }
})

test.describe('a link in running text', () => {
  test('skips a link inside a sentence, which the sentence carries', async ({ page }) => {
    await fixture(page, `<p>Read the <a href="#terms">terms</a> before you start.</p>`)
    expect(await missedTaps(page)).toEqual([])
  })

  test('finds a link standing alone in its box', async ({ page }) => {
    await fixture(page, `<div><a href="#rules">Edit</a></div>`)
    expect(await missedWithoutSize(page)).toEqual(['<a> "Edit" misses a 44px tap'])
  })

  test('finds a link alone under a heading', async ({ page }) => {
    await fixture(page, `<section><h2>Goals</h2><a href="#goals">All goals</a></section>`)
    expect(await missedWithoutSize(page)).toEqual(['<a> "All goals" misses a 44px tap'])
  })

  test('finds a link on its own line after a paragraph, in the same box', async ({ page }) => {
    await fixture(page, `<div>Nothing recorded yet.<br><a href="#history">Show history</a></div>`)
    expect(await missedWithoutSize(page)).toEqual(['<a> "Show history" misses a 44px tap'])
  })
})

test.describe('a hit area wider than what shows', () => {
  test('finds a 28px dot alone, and passes it with a 44px hit area around it', async ({ page }) => {
    await fixture(page, `<button class="dot" aria-label="Blue"></button>`, DOT)
    expect(await missedTaps(page)).toEqual(['<button.dot> "Blue" misses a 44px tap (28x28)'])

    // The hit area is drawn by the dot itself, so a tap on it is a tap on the
    // dot, and the dot still looks 28px to every other check.
    await fixture(
      page,
      `<div style="padding: 20px"><button class="dot wide-tap" aria-label="Blue"></button></div>`,
      DOT,
    )
    expect(await missedTaps(page)).toEqual([])
    expect(await layoutProblems(page)).toEqual([])
  })

  test('finds a checkbox alone, and passes one whose label takes the tap', async ({ page }) => {
    await fixture(page, `<input type="checkbox" aria-label="Include Groceries">`)
    expect(await missedTaps(page)).toEqual([
      '<input> "Include Groceries" misses a 44px tap (13x13)',
    ])

    await fixture(
      page,
      `<label style="display: flex; align-items: center; gap: 12px; min-height: 44px; padding-left: 16px">
        <input type="checkbox" aria-label="Include Groceries"> Groceries
      </label>`,
    )
    expect(await missedTaps(page)).toEqual([])
  })
})

test.describe('a control a tap cannot reach', () => {
  test('finds one placed off the page, which no scrolling brings into view', async ({ page }) => {
    await fixture(
      page,
      `<button style="position: absolute; left: -500px; width: 120px; height: 44px">Undo</button>`,
    )
    expect(await missedTaps(page)).toEqual(['<button> "Undo" misses a 44px tap (120x44)'])
  })

  test('scrolls to one below the fold: finds it too small, and passes it at 44px', async ({
    page,
  }) => {
    const below = (height: number) =>
      `<div style="height: 2000px"></div><button style="width: 120px; height: ${height}px">Later</button>`
    await fixture(page, below(30))
    expect(await missedTaps(page)).toEqual(['<button> "Later" misses a 44px tap (120x30)'])

    await fixture(page, below(44))
    expect(await missedTaps(page)).toEqual([])
  })

  test('finds a control a neighbour is drawn over, and passes the two kept apart', async ({
    page,
  }) => {
    const pair = (gap: number) => `
      <button style="display: block; width: 120px; height: 44px">Add</button>
      <button style="display: block; width: 120px; height: 44px; margin-top: ${gap}px; position: relative">History</button>`
    await fixture(page, pair(-10))
    expect(await missedTaps(page)).toEqual(['<button> "Add" misses a 44px tap (120x44)'])

    await fixture(page, pair(8))
    expect(await missedTaps(page)).toEqual([])
  })

  test("finds a control under a neighbour's hit area, though their boxes are apart", async ({
    page,
  }) => {
    // The dot sits centred under the button, which is 120px across.
    const pair = (gap: number) => `<div style="padding: 20px">
      <button style="display: block; width: 120px; height: 44px">Add</button>
      <button class="dot wide-tap" style="display: block; margin: ${gap}px 0 0 46px" aria-label="Blue"></button>
    </div>`
    // Its 44px hit area reaches 8px above it, past the button 4px above.
    await fixture(page, pair(4), DOT)
    expect(await missedTaps(page)).toEqual(['<button> "Add" misses a 44px tap (120x44)'])

    await fixture(page, pair(12), DOT)
    expect(await missedTaps(page)).toEqual([])
  })
})

test.describe("a neighbour's hit area reaching over a control", () => {
  // A wide row, and under its right end a small link, as "Edit budgets" sits
  // under a widget's last row: the link's own box is clear of the row's.
  const rowAndLink = (link: string) => `<div style="padding: 20px; width: 300px">
    <a href="#groceries" style="display: block; height: 44px">Groceries</a>
    <a href="#edit" class="wide-tap" style="${link}">Edit</a>
  </div>`

  test('finds a row whose corner a small link takes, and passes the link drawn 44px tall', async ({
    page,
  }) => {
    // 20px tall and 4px below the row, its 44px hit area reaches 8px over it.
    await fixture(
      page,
      rowAndLink('display: block; width: 40px; height: 20px; margin: 4px 0 0 250px'),
      DOT,
    )
    expect(await missedTaps(page)).toEqual([
      '<a> "Groceries" loses taps to <a.wide-tap> "Edit"\'s hit area',
    ])

    // A real 44px box under the row: the hit area is the box, and reaches nothing.
    await fixture(
      page,
      rowAndLink(
        'display: flex; align-items: center; width: 40px; min-height: 44px; margin-left: 250px',
      ),
      DOT,
    )
    expect(await missedTaps(page)).toEqual([])
  })
})

test.describe('a control hidden on purpose', () => {
  for (const hiding of ['display: none', 'visibility: hidden', 'opacity: 0']) {
    test(`skips one hidden with ${hiding}`, async ({ page }) => {
      await fixture(page, `<button style="width: 20px; height: 20px; ${hiding}">x</button>`)
      expect(await missedTaps(page)).toEqual([])
    })
  }
})
