// The layout guard's checks (layout.ts), each proven on a small page broken
// on purpose, and on the same page fixed, so a check that can never fail, or
// that cries wolf, shows up here rather than on a real screen.

import { expect, test, type Page } from '@playwright/test'
import { findProblems, layoutProblems, type LayoutCheck } from './layout'

/** A bare page at phone width: system font, no margins, the given body. */
async function fixture(page: Page, body: string, css = ''): Promise<void> {
  await page.setContent(`<!doctype html>
    <html><head><style>
      body { margin: 0; font: 16px/1.4 sans-serif; }
      ${css}
    </style></head><body>${body}</body></html>`)
}

/** The messages one check finds. */
const found = async (page: Page, check: LayoutCheck) =>
  (await findProblems(page, check)).map((problem) => problem.message)

test.use({ viewport: { width: 390, height: 844 } })

test('a tidy page has no problems at all', async ({ page }) => {
  await fixture(
    page,
    `<main style="padding: 16px">
      <h1>Settings</h1>
      <div style="display: flex; gap: 12px; align-items: center">
        <span style="flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap">
          A widget name far too long to fit on one line beside its buttons
        </span>
        <button>Up</button><button>Down</button>
      </div>
      <p>Words wrap between words, never inside them, at any width at all.</p>
    </main>`,
  )
  expect(await layoutProblems(page)).toEqual([])
})

test.describe('overlap', () => {
  test('finds a control drawn over text', async ({ page }) => {
    await fixture(
      page,
      `<div style="position: relative">
        <span>Surplus</span>
        <button style="position: absolute; left: 0; top: 0">Half</button>
      </div>`,
    )
    expect(await found(page, 'overlap')).toEqual(['<span> "Surplus" overlaps <button> "Half"'])
  })

  test('finds text drawn over other text', async ({ page }) => {
    await fixture(
      page,
      `<p style="margin: 0">Heads up</p><p style="margin: 0; position: relative; top: -1em">At a glance</p>`,
    )
    expect(await found(page, 'overlap')).toEqual(['<p> "Heads up" overlaps <p> "At a glance"'])
  })

  test('measures a turned chart label by its own shape, not the box around it', async ({
    page,
  }) => {
    // "Steady pace" climbs a slope; the amount sits in the empty corner under it.
    const chart = (amountX: number, amountY: number) =>
      `<svg width="300" height="300">
        <text x="100" y="150" transform="rotate(-45 100 150)">Steady pace</text>
        <text x="${amountX}" y="${amountY}">$1,003</text>
      </svg>`
    await fixture(page, chart(150, 150))
    expect(await found(page, 'overlap')).toEqual([])
    await fixture(page, chart(105, 140))
    expect(await found(page, 'overlap')).toEqual(['<text> "Steady pace" overlaps <text> "$1,003"'])
  })

  test('leaves alone a button with its own label, and a bar the page scrolls under', async ({
    page,
  }) => {
    // At the top of a long page, its middle passes under the tab bar on the way up.
    await fixture(
      page,
      `<button><span>Move up</span></button>
      <p style="margin-top: 800px">Passing under</p>
      <p style="margin: 400px 0 80px">Last line</p>
      <nav style="position: fixed; bottom: 0; left: 0; right: 0; height: 60px; background: #fff">
        <a href="#">Overview</a>
      </nav>`,
    )
    expect(await found(page, 'overlap')).toEqual([])
  })

  test('finds the end of a page left resting under the tab bar', async ({ page }) => {
    const ending = (room: string) =>
      `<p style="margin: 1000px 0 ${room}">Last line</p>
      <nav style="position: fixed; bottom: 0; left: 0; right: 0; height: 60px; background: #fff">
        <a href="#">Overview</a>
      </nav>`
    await fixture(page, ending('0'))
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
    expect(await found(page, 'overlap')).toEqual(['<p> "Last line" rests under <nav> "Overview"'])

    // With room for the bar at the end, the last line comes to rest above it.
    await fixture(page, ending('80px'))
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
    expect(await found(page, 'overlap')).toEqual([])
  })

  test('ignores text painted in a transparent color', async ({ page }) => {
    await fixture(
      page,
      `<div style="position: relative">
        <span style="color: transparent">Surplus</span>
        <button style="position: absolute; left: 0; top: 0">Half</button>
      </div>`,
    )
    expect(await found(page, 'overlap')).toEqual([])
  })

  test('ignores text a hidden ancestor keeps off screen', async ({ page }) => {
    await fixture(
      page,
      `<button>Show</button>
      <span style="position: absolute; top: 0; left: 0; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0)">
        <span>Read out only</span>
      </span>`,
    )
    expect(await found(page, 'overlap')).toEqual([])
  })
})

test.describe('clipped', () => {
  test('finds text cut off without an ellipsis', async ({ page }) => {
    await fixture(
      page,
      `<div style="width: 40px; overflow: hidden; white-space: nowrap">Surplus</div>`,
    )
    expect(await found(page, 'clipped')).toEqual(['<div> "Surplus" is cut off with no ellipsis'])
  })

  test('finds text cut off by an ancestor that hides its overflow', async ({ page }) => {
    await fixture(
      page,
      `<div class="box" style="width: 60px; overflow: hidden"><b style="white-space: nowrap">Heads up</b></div>`,
    )
    expect(await found(page, 'clipped')).toEqual([
      '<b> "Heads up" is cut off by <div.box> "Heads up"',
    ])
  })

  test('finds text spilling out of its box', async ({ page }) => {
    await fixture(page, `<div style="width: 60px; white-space: nowrap">Categories</div>`)
    expect(await found(page, 'clipped')).toEqual(['<div> "Categories" spills out of its box'])
  })

  test('finds a picker cutting off its choice without an ellipsis', async ({ page }) => {
    await fixture(
      page,
      `<select style="width: 90px"><option>Subscriptions and services</option></select>`,
    )
    expect(await found(page, 'clipped')).toEqual([
      '<select> "Subscriptions and services" cuts off "Subscriptions and services"',
    ])
  })

  test('finds a name its row squeezed to nothing, though it would end in an ellipsis', async ({
    page,
  }) => {
    await fixture(
      page,
      `<div style="display: flex; width: 300px">
        <span style="flex: 0 1 0; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap">Spending pace</span>
        <button style="flex: none; width: 300px">Half</button>
      </div>`,
    )
    expect(await found(page, 'clipped')).toEqual(['<span> "Spending pace" is squeezed to 0px'])
  })

  test('finds an ellipsis that leaves only a letter or two', async ({ page }) => {
    await fixture(
      page,
      `<div style="width: 24px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap">Surplus</div>`,
    )
    expect(await found(page, 'clipped')).toEqual(['<div> "Surplus" is squeezed to 24px'])
  })

  test('finds lines cut off by a box too short for them', async ({ page }) => {
    await fixture(
      page,
      `<div style="width: 120px; height: 1.4em; overflow: hidden">Total spent this paycheck so far</div>`,
    )
    expect(await found(page, 'clipped')).toEqual([
      '<div> "Total spent this paycheck so far" is cut off at the bottom',
    ])
  })

  test('accepts lines a line clamp ends with an ellipsis', async ({ page }) => {
    await fixture(
      page,
      `<div style="width: 120px; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 1; overflow: hidden">Total spent this paycheck so far</div>`,
    )
    expect(await found(page, 'clipped')).toEqual([])
  })

  test('accepts an ellipsis, a row that scrolls sideways and a picker with an ellipsis', async ({
    page,
  }) => {
    await fixture(
      page,
      `<div style="width: 60px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis">Surplus</div>
      <div style="width: 60px; overflow-x: auto; white-space: nowrap"><a href="#">Appearance</a></div>
      <select style="width: 90px; text-overflow: ellipsis"><option>Subscriptions and services</option></select>`,
    )
    expect(await found(page, 'clipped')).toEqual([])
  })
})

test.describe('broken-word', () => {
  test('finds a label word split across lines', async ({ page }) => {
    await fixture(page, `<div style="width: 30px; overflow-wrap: anywhere">Surplus</div>`)
    expect(await found(page, 'broken-word')).toEqual([
      '"Surplus" breaks across lines in <div> "Surplus"',
    ])
  })

  test('accepts wrapping between words, after a hyphen, and a long code wider than its line', async ({
    page,
  }) => {
    await fixture(
      page,
      `<div style="width: 60px">At a glance</div>
      <div style="width: 90px">Low-balance warnings</div>
      <div style="width: 200px; overflow-wrap: anywhere">REF${'0123456789'.repeat(6)}</div>
      <code style="display: block; width: 120px; word-break: break-all">https://leeway.example.com/mcp</code>`,
    )
    expect(await found(page, 'broken-word')).toEqual([])
  })
})

test.describe('page-overflow', () => {
  test('finds a page wider than the screen and names what sticks out', async ({ page }) => {
    await fixture(page, `<main><div class="wide" style="width: 500px">Wide</div></main>`)
    expect(await found(page, 'page-overflow')).toEqual([
      'the page is 110px wider than the screen; sticking out: <div.wide> "Wide"',
    ])
  })

  test('finds content past the edge of a page that hides its sideways overflow', async ({
    page,
  }) => {
    await fixture(
      page,
      `<main><div class="wide" style="width: 500px">Wide</div></main>`,
      'html, body { overflow-x: hidden; }',
    )
    expect(await found(page, 'page-overflow')).toEqual([
      '<html> hides sideways overflow (overflow-x: hidden), so content past the edge is cut off unseen',
      '<body> hides sideways overflow (overflow-x: hidden), so content past the edge is cut off unseen',
      'content runs off the screen; sticking out: <div.wide> "Wide"',
    ])
  })

  test('accepts a wide table inside a box that scrolls sideways', async ({ page }) => {
    await fixture(page, `<div style="overflow-x: auto"><div style="width: 500px">Wide</div></div>`)
    expect(await found(page, 'page-overflow')).toEqual([])
  })
})

test.describe('safe-area', () => {
  // An iPhone held upright has a 47px status bar; sideways, a 47px notch on each side.
  const UPRIGHT = ':root { --sat: 47px; --sar: 0px; --sab: 34px; --sal: 0px; }'
  const SIDEWAYS = ':root { --sat: 0px; --sar: 47px; --sab: 21px; --sal: 47px; }'
  const BACKDROP = (fill: string) =>
    `<div style="position: fixed; top: 0; left: 0; right: 0; height: var(--sat); background: ${fill}; pointer-events: none"></div>`

  test('finds scrolled text under the status bar with nothing over it', async ({ page }) => {
    await fixture(page, `<p style="margin: 10px 16px">Total spent</p>`, UPRIGHT)
    expect(await found(page, 'safe-area')).toEqual(['<p> "Total spent" shows under the status bar'])
  })

  test('accepts the same text under an opaque backdrop that ignores the pointer', async ({
    page,
  }) => {
    await fixture(
      page,
      `<p style="margin: 10px 16px">Total spent</p>${BACKDROP('#0d0f12')}`,
      UPRIGHT,
    )
    expect(await found(page, 'safe-area')).toEqual([])
  })

  test('finds a see-through backdrop', async ({ page }) => {
    await fixture(
      page,
      `<p style="margin: 10px 16px">Total spent</p>${BACKDROP('rgba(13, 15, 18, 0.3)')}`,
      UPRIGHT,
    )
    expect(await found(page, 'safe-area')).toEqual(['<p> "Total spent" shows under the status bar'])
  })

  test('finds a card background under the status bar too', async ({ page }) => {
    await fixture(page, `<div style="height: 80px; background: #15181d"></div>`, UPRIGHT)
    expect(await found(page, 'safe-area')).toEqual(['<div> shows under the status bar'])
  })

  test('finds a control in the notch when turned sideways, but not a background', async ({
    page,
  }) => {
    await fixture(
      page,
      `<nav style="position: fixed; bottom: 0; left: 0; right: 0; padding: 8px 0 calc(8px + var(--sab)); background: #15181d">
        <a href="#">Overview</a>
      </nav>`,
      SIDEWAYS,
    )
    expect(await found(page, 'safe-area')).toEqual(['<a> "Overview" shows under the left inset'])
  })

  test('has nothing to check where there are no insets', async ({ page }) => {
    await fixture(page, `<p style="margin: 0">Total spent</p>`)
    expect(await found(page, 'safe-area')).toEqual([])
  })
})
