// The overlap check (layout/overlap.ts and covered.ts), proven on small pages
// broken on purpose and on the same pages fixed: text over text or a control,
// text under a box laid over it, page content resting under a fixed bar, and
// floating layers drawn over each other.

import { expect, test } from '@playwright/test'
import { fixture, found } from './layout-fixture'

test.use({ viewport: { width: 390, height: 844 } })

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

  test('finds text hidden under a card laid over it, where the card has no text', async ({
    page,
  }) => {
    // A second alert's card drawn over the first alert's words, as on Accounts.
    const alerts = (top: string) =>
      `<p style="margin: 0">Overdrawn by $142.10</p>
      <div class="card" style="position: absolute; top: ${top}; left: 0; width: 300px; height: 40px; background: #3a1418"></div>`
    await fixture(page, alerts('0'))
    expect(await found(page, 'overlap')).toEqual([
      '<p> "Overdrawn by $142.10" is covered by <div.card>',
    ])
    await fixture(page, alerts('60px'))
    expect(await found(page, 'overlap')).toEqual([])
  })

  test('leaves alone text on its own card, a see-through box, and a label over a bar', async ({
    page,
  }) => {
    await fixture(
      page,
      `<div style="background: #15181d; padding: 8px"><p style="margin: 0">On its card</p></div>
      <div style="position: relative">
        <p style="margin: 0">Under glass</p>
        <div class="glass" style="position: absolute; inset: 0; border: 1px solid #888"></div>
      </div>
      <div style="position: relative; height: 24px; background: #2b6;">
        <span style="position: absolute; left: 8px; pointer-events: none">Groceries</span>
      </div>`,
    )
    expect(await found(page, 'overlap')).toEqual([])
  })

  test('names a heading drawn over text once, not again as a cover', async ({ page }) => {
    await fixture(
      page,
      `<p style="margin: 0">Corner market</p>
      <h2 style="position: absolute; top: 0; left: 0; margin: 0; background: #fff">Today</h2>`,
    )
    expect(await found(page, 'overlap')).toEqual(['<p> "Corner market" overlaps <h2> "Today"'])
  })

  test('finds a bar held over the tab bar, at any scroll', async ({ page }) => {
    // A bar that rides above the tab bar as the page scrolls, set too low.
    const bars = (bottom: string) =>
      `<div style="height: 1400px"></div>
      <div class="select-bar" style="position: sticky; bottom: ${bottom}; height: 48px; background: #222">
        <button>Add up</button>
      </div>
      <div style="height: 400px"></div>
      <nav style="position: fixed; bottom: 0; left: 0; right: 0; height: 60px; background: #fff; text-align: right">
        <a href="#">Overview</a>
      </nav>`
    await fixture(page, bars('16px'))
    expect(await found(page, 'overlap')).toEqual([
      '<div.select-bar> "Add up" is drawn over <nav> "Overview"',
    ])
    await page.evaluate(() => window.scrollTo(0, 600))
    expect(await found(page, 'overlap')).toEqual([
      '<div.select-bar> "Add up" is drawn over <nav> "Overview"',
    ])
    await fixture(page, bars('76px'))
    expect(await found(page, 'overlap')).toEqual([])
  })

  test('finds text in one fixed bar over text in another', async ({ page }) => {
    await fixture(
      page,
      `<div class="toast" style="position: fixed; bottom: 44px; left: 0">Saved</div>
      <nav style="position: fixed; bottom: 0; left: 0; right: 0; height: 60px">
        <a href="#">Overview</a>
      </nav>`,
    )
    expect(await found(page, 'overlap')).toEqual([
      '<div.toast> "Saved" overlaps <a> "Overview"',
      '<div.toast> "Saved" is drawn over <nav> "Overview"',
    ])
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
