// Every switch draws the same in every engine: its knob centred in its track,
// off and on, and the switch centred on its row. It runs in Chromium with the
// desktop tests and in WebKit too (playwright.config.ts's webkit project, in
// CI or with E2E_WEBKIT=1), since Safari once drew the knob below the track.

import { expect, test, type Locator, type Page } from '@playwright/test'

/** A Settings page with switches, and what shows once its switches are all in. */
interface SwitchPage {
  path: string
  loaded: (page: Page) => Locator
}

/**
 * The pages with switches. Some sections fetch their own data after the page
 * opens (notifications, email, accounts), so each page names what shows once
 * that data is in, and the sweep never measures a page that is still loading.
 */
const PAGES: SwitchPage[] = [
  { path: '/settings/appearance', loaded: (page) => named(page, 'Show Spending pace') },
  { path: '/settings/notifications', loaded: (page) => named(page, 'Notify me: Overdrawn') },
  { path: '/settings/budgeting', loaded: (page) => named(page, 'Count pending transactions') },
  { path: '/settings/email', loaded: (page) => named(page, 'Send me a weekly email') },
  {
    path: '/settings/accounts',
    // Accounts come and go with the specs before this one, so either will do.
    loaded: (page) =>
      page
        .getByRole('switch', { name: /^Count / })
        .or(page.getByText(/^No accounts yet/))
        .first(),
  },
  {
    path: '/settings/assistant',
    loaded: (page) => named(page, 'Have Claude write the dashboard summary'),
  },
]

/** The switch with this name. */
function named(page: Page, name: string): Locator {
  return page.getByRole('switch', { name })
}

/** A box on the page, in CSS pixels. */
interface Box {
  top: number
  bottom: number
  left: number
  right: number
}

/**
 * Where a switch draws its track and knob (its ::before and ::after, from
 * their computed styles, the knob's slide included), and the centre of its
 * row's label.
 */
async function measure(control: Locator) {
  return control.evaluate((el) => {
    const box = el.getBoundingClientRect()
    const part = (pseudo: string) => {
      const style = getComputedStyle(el, pseudo)
      const slide = new DOMMatrixReadOnly(style.transform === 'none' ? undefined : style.transform)
      const top = box.top + parseFloat(style.top) + slide.m42
      const left = box.left + parseFloat(style.left) + slide.m41
      return {
        top,
        left,
        bottom: top + parseFloat(style.height),
        right: left + parseFloat(style.width),
      }
    }
    const row = el.closest('.setting, .layout-row-name, .list-row') ?? el.parentElement!
    const label = row.querySelector('.setting-label, .ellipsis') ?? row
    const text = label.getBoundingClientRect()
    return {
      track: part('::before'),
      knob: part('::after'),
      centre: (box.top + box.bottom) / 2,
      labelCentre: (text.top + text.bottom) / 2,
    }
  })
}

/** The knob sits inside the track with even room above and below, and on either side. */
function expectCentred(track: Box, knob: Box) {
  const above = knob.top - track.top
  const below = track.bottom - knob.bottom
  expect(above).toBeGreaterThan(0)
  expect(Math.abs(above - below)).toBeLessThanOrEqual(1)
  expect(knob.left).toBeGreaterThan(track.left)
  expect(knob.right).toBeLessThan(track.right)
}

/** Waits out the knob's slide, then checks it and the switch's place on its row. */
async function expectWellPlaced(control: Locator) {
  await expect
    .poll(async () => {
      const { track, knob } = await measure(control)
      return Math.round(knob.left - track.left) === 4 || Math.round(track.right - knob.right) === 4
    })
    .toBe(true)
  const { track, knob, centre, labelCentre } = await measure(control)
  expectCentred(track, knob)
  // The track is centred in the switch's box, and the switch on its row.
  expect(Math.abs((track.top + track.bottom) / 2 - centre)).toBeLessThanOrEqual(1)
  expect(Math.abs(centre - labelCentre)).toBeLessThanOrEqual(2)
}

/** Flips a switch and waits for the save, so the next step reads the saved state. */
async function flip(page: Page, control: Locator) {
  const saved = page.waitForResponse((r) => r.url().endsWith('/api/actions/update_settings'))
  await control.click()
  expect((await saved).ok()).toBe(true)
}

test('a switch keeps its knob inside its track, off and on, centred on its row', async ({
  page,
}) => {
  await page.goto('/settings/appearance')
  const control = page.getByRole('switch', { name: 'Show Spending pace' })
  const before = await control.getAttribute('aria-checked')
  await expectWellPlaced(control)
  await flip(page, control)
  await expect(control).not.toHaveAttribute('aria-checked', before!)
  await expectWellPlaced(control)
  // Back as it was, for the tests after this one.
  await flip(page, control)
  await expect(control).toHaveAttribute('aria-checked', before!)
})

test('every switch in Settings is drawn the same way', async ({ page }) => {
  // Open Settings as anyone who has been here before does, with the service
  // worker running (it registers on every page load), rather than with
  // whatever part of its install finished before the next page opened.
  await page.goto(PAGES[0]!.path)
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
  })

  let seen = 0
  for (const { path, loaded } of PAGES) {
    // One step per page, so a failure names the page it happened on.
    await test.step(path, async () => {
      await page.goto(path)
      await expect(loaded(page)).toBeVisible()
      for (const control of await page.getByRole('switch').all()) {
        if (!(await control.isVisible())) continue
        await expectWellPlaced(control)
        seen += 1
      }
    })
  }
  // Settings has switches on several pages; finding none would mean the test checked nothing.
  expect(seen).toBeGreaterThan(4)
})

test('a focused switch rings its round track, not the square box around it', async ({ page }) => {
  await page.goto('/settings/appearance')
  const control = page.getByRole('switch', { name: 'Show Spending pace' })
  await control.focus()
  await page.keyboard.press('Shift+Tab')
  await page.keyboard.press('Tab')
  await expect(control).toBeFocused()
  const ring = await control.evaluate((el) => {
    const own = getComputedStyle(el)
    const track = getComputedStyle(el, '::before')
    return {
      own: own.outlineStyle,
      track: track.outlineStyle,
      width: track.outlineWidth,
      radius: track.borderRadius,
    }
  })
  expect(ring).toEqual({ own: 'none', track: 'solid', width: '2px', radius: '99px' })
})
