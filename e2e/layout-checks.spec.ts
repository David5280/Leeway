// The layout guard's checks (layout.ts), each proven on a small page broken
// on purpose, and on the same page fixed, so a check that can never fail, or
// that cries wolf, shows up here rather than on a real screen. The clipped
// check, with the most ways to go wrong, has a file of its own
// (layout-clipped.spec.ts).

import { expect, test } from '@playwright/test'
import { layoutProblems } from './layout'
import { fixture, found } from './layout-fixture'

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

  test('checks a popover a clip-path only rounds, but not one it clips to nothing', async ({
    page,
  }) => {
    // A menu laid over a row by mistake, drawn through `clip`.
    const menu = (clip: string) =>
      `<p style="margin: 0">Groceries</p>
      <div class="menu" style="position: absolute; top: 0; left: 0; width: 200px; clip-path: ${clip}">
        <span>Rename</span>
      </div>`
    await fixture(page, menu('inset(0 round 12px)'))
    expect(await found(page, 'overlap')).toEqual(['<p> "Groceries" overlaps <span> "Rename"'])
    for (const hidden of ['inset(50%)', 'inset(0 0 100% 0)', 'circle(0)']) {
      await fixture(page, menu(hidden))
      expect(await found(page, 'overlap'), hidden).toEqual([])
    }
  })

  test('lets rows pass under a held sticky heading, but checks one in its place', async ({
    page,
  }) => {
    // A day's heading kept in view over its rows, then a long way to scroll.
    const day = (pull: string) =>
      `<section>
        <h2 style="position: sticky; top: 0; margin: 0 0 ${pull}; background: #fff; font-size: 16px">Today</h2>
        ${['Corner market', 'Shell', 'Acme Payroll', 'Xcel Energy'].map((name) => `<p style="margin: 0; height: 40px">${name}</p>`).join('')}
      </section>
      <div style="height: 2000px"></div>`
    // Still in its place, it must not cover the first row.
    await fixture(page, day('-12px'))
    expect(await found(page, 'overlap')).toEqual(['<h2> "Today" overlaps <p> "Corner market"'])

    await fixture(page, day('0'))
    expect(await found(page, 'overlap')).toEqual([])
    // Stuck at the top as the rows go by, then pushed up by the day's end.
    for (const y of [70, 400]) {
      await page.evaluate((top) => window.scrollTo(0, top), y)
      expect(await found(page, 'overlap'), `scrolled ${y}px`).toEqual([])
    }
  })

  test('leaves alone the page behind a modal dialog, which is inert', async ({ page }) => {
    const behind = (inert: string) =>
      `<main ${inert}><p style="margin: 0">Groceries</p></main>
      <div role="dialog" style="position: fixed; top: 0; left: 0; right: 0; background: #fff">
        <h2 style="margin: 0">Amazon</h2>
      </div>`
    await fixture(page, behind(''))
    expect(await found(page, 'overlap')).toEqual(['<p> "Groceries" rests under <div> "Amazon"'])
    await fixture(page, behind('inert'))
    expect(await found(page, 'overlap')).toEqual([])
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
