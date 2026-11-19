// The layout guard's checks (layout.ts), each proven on a small page broken
// on purpose, and on the same page fixed, so a check that can never fail, or
// that cries wolf, shows up here rather than on a real screen. The checks
// with the most ways to go wrong have files of their own: overlap
// (layout-overlap.spec.ts) and clipped (layout-clipped.spec.ts). The guard's
// seed is held here to what it must put on screen.

import { expect, test } from '@playwright/test'
import { layoutProblems } from './layout'
import { fixture, found } from './layout-fixture'
import { action, emptySeed, removeSeed, seedEveryScreen } from './seed'

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

test("the guard's seed puts two alerts on one account at once", async ({ request }) => {
  // Alerts stack one under the other wherever they show; with none seeded,
  // the guard never saw two of them meet (the Accounts overlap it missed).
  const seeded = emptySeed()
  try {
    await seedEveryScreen(request, seeded)
    const alerts = await action<{ kind: string; accountId: string }[]>(request, 'list_alerts')
    const kindsOn = (id: string) => alerts.filter((a) => a.accountId === id).map((a) => a.kind)
    expect(seeded.accounts.map(kindsOn)).toContainEqual(['overdrawn', 'overdraft_fee'])
  } finally {
    await removeSeed(request, seeded)
  }
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
