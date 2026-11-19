// The phone layout guard: every screen, and the forms that open on them, on
// the iPhones in GUARDED_PHONES, upright and turned sideways, installed to the
// home screen, with lists full of long names. Each screen must have no text
// over other text or controls, no text cut off without an ellipsis (or squeezed
// to a sliver with one), no word split across lines, no sideways scrolling,
// nothing showing under the status bar, the notch or the home indicator, and
// no control a finger's 44px tap can miss. The checks themselves are in
// layout.ts. Every route the app answers (web/src/routes.ts) must have a
// screen here; a test below makes sure.

import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { ROUTES, type RouteName } from '../web/src/routes'
import { SCREENS, SETTINGS_GROUPS } from './guarded-screens'
import {
  describeProblems,
  findProblems,
  layoutProblems,
  missedTaps,
  type LayoutProblem,
} from './layout'
import { OWNER, SETUP_CODE } from './owner'
import { GUARDED_PHONES, simulateInsets, type Insets } from './phone'
import { action, emptySeed, removeSeed, seedEveryScreen, type Seeded } from './seed'

/** Waits until the screen has its data, fonts and final layout. */
async function settle(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible()
  await page.waitForLoadState('networkidle')
  await expect(page.locator('.spinner')).toHaveCount(0)
  // Fonts swap in late, and charts measure their width a frame after they mount.
  await page.evaluate(async () => {
    await document.fonts.ready
    await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))
  })
}

/**
 * Scrolls a share of the way down the page (0 the top, 1 the end) at once,
 * and waits until the page stays there for a frame. A form that opens scrolls
 * itself into view smoothly (FormCard), and that scroll can carry on past a
 * single jump, so the jump repeats until the page holds still.
 */
async function scrollTo(page: Page, share: number): Promise<void> {
  const message = `the page would not hold still ${Math.round(share * 100)}% of the way down`
  await expect
    .poll(
      () =>
        page.evaluate(async (to) => {
          const target = Math.round(
            (document.documentElement.scrollHeight - window.innerHeight) * to,
          )
          window.scrollTo({ top: target, behavior: 'instant' })
          await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))
          return Math.abs(window.scrollY - target) <= 1
        }, share),
      { message },
    )
    .toBe(true)
}

/**
 * Every problem on the screen: all layout checks at the top, then the safe
 * areas again scrolled halfway, where content has moved under the status bar,
 * and at the end, where the last content must also rest clear of the tab bar.
 * Last, every control's tap, which scrolls each one into view to probe it.
 */
async function problemsOn(page: Page): Promise<string[]> {
  await scrollTo(page, 0)
  const problems: LayoutProblem[] = await layoutProblems(page)
  for (const [share, checks] of [
    [0.5, ['safe-area']],
    [1, ['safe-area', 'overlap']],
  ] as const) {
    await scrollTo(page, share)
    for (const check of checks) problems.push(...(await findProblems(page, check)))
  }
  const taps = (await missedTaps(page)).map((message) => `tap: ${message}`)
  // Each problem once, however many scroll positions found it.
  return [...new Set(describeProblems(problems)), ...taps]
}

/** Loads a screen as an installed app on this phone draws it, ready to check. */
async function load(page: Page, path: string, insets: Insets): Promise<void> {
  await page.goto(path)
  await simulateInsets(page, insets)
  await settle(page)
}

for (const phone of GUARDED_PHONES) {
  test.describe(`on ${phone.name}`, () => {
    test.use(phone.screen)

    test.describe('signed in', () => {
      // Long names in every list while these run, gone again after.
      const seeded: Seeded = emptySeed()
      test.beforeAll(async ({ request }) => {
        await seedEveryScreen(request, seeded)
      })
      test.afterAll(async ({ request }) => {
        await removeSeed(request, seeded)
        Object.assign(seeded, emptySeed())
      })

      for (const screen of SCREENS.filter((one) => one.on?.(phone) ?? true)) {
        test(`${screen.name} lays out cleanly`, async ({ page, request }) => {
          await load(page, await screen.path(seeded, request), phone.insets)
          if (screen.then) {
            await screen.then(page)
            await settle(page)
          }
          expect(await problemsOn(page)).toEqual([])
        })
      }

      test('the header takes at most a fifth of the height, on a screen tapped with a finger', async ({
        page,
      }) => {
        await load(page, '/transactions', phone.insets)
        const { width, height } = phone.screen.viewport
        const header = (await page.getByRole('banner').boundingBox())!
        expect(header.y + header.height).toBeLessThanOrEqual(height * 0.2)
        // Sideways, the slim header's links navigate and the tab bar gives its height back.
        const links = page.getByRole('banner').getByRole('navigation', { name: 'Main' })
        const tabs = page.locator('.tabbar')
        await (width > height ? expect(links).toBeVisible() : expect(links).toBeHidden())
        await (width > height ? expect(tabs).toBeHidden() : expect(tabs).toBeVisible())
        // The tap sizes checked on every screen (problemsOn) hold only where
        // the phone reports a finger rather than a mouse.
        expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true)
      })

      test(`the overview is arranged ${phone.editsInPlace ? 'in place' : 'in Settings'}`, async ({
        page,
      }) => {
        await load(page, '/', phone.insets)
        const edit = page.getByRole('button', { name: 'Edit layout' })
        await (phone.editsInPlace ? expect(edit).toBeVisible() : expect(edit).toBeHidden())
        // Either way, Settings arranges it too, and the guard checks it there on every phone.
        await load(page, '/settings/appearance', phone.insets)
        await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
        await expect(page.getByRole('group', { name: 'Summary order' })).toBeVisible()
      })

      test('the Settings menu has every group the guard visits', async ({ page }) => {
        await load(page, '/settings/appearance', phone.insets)
        const menu = page.getByRole('navigation', { name: 'Settings groups' })
        const links = await menu
          .getByRole('link')
          .evaluateAll((all) =>
            all.map((link) => new URL((link as HTMLAnchorElement).href).pathname),
          )
        expect(links).toEqual(SETTINGS_GROUPS.map((group) => `/settings/${group}`))
      })

      test.describe('first-run setup', () => {
        /**
         * Setup runs once per install, and this one is set up already, so the
         * server's answers are changed on their way to the page: no owner yet for
         * the first two steps, and not onboarded for the rest. Steps that would
         * save something are answered without saving, so the install stays as
         * the other tests expect it.
         */
        async function pretendSetUpIsDue(page: Page, request: APIRequestContext) {
          const settings = await action(request, 'get_settings')
          await page.route('**/api/auth/me', async (route) => {
            const me = await (await route.fetch()).json()
            await route.fulfill({ json: { owner: { ...me.owner, onboarded: false } } })
          })
          await page.route('**/api/actions/update_settings', (route) =>
            route.fulfill({ json: { result: settings } }),
          )
          await page.route('**/api/actions/complete_setup', (route) =>
            route.fulfill({ json: { result: {} } }),
          )
        }

        const STEPS: { heading: string; reach: (page: Page) => Promise<void> }[] = [
          { heading: 'How do you budget?', reach: async () => {} },
          {
            heading: 'Sync your bank',
            reach: (page) => page.getByRole('button', { name: 'Continue' }).click(),
          },
          {
            heading: 'Choose your categories',
            reach: (page) => page.getByRole('button', { name: 'Skip for now' }).click(),
          },
          {
            heading: "You're set",
            reach: (page) => page.getByRole('button', { name: 'Continue' }).click(),
          },
        ]

        for (const [index, step] of STEPS.entries()) {
          test(`the "${step.heading}" step lays out cleanly`, async ({ page, request }) => {
            await pretendSetUpIsDue(page, request)
            await load(page, '/', phone.insets)
            // Walk to this step through the ones before it.
            for (const earlier of STEPS.slice(0, index + 1)) {
              await earlier.reach(page)
              await expect(page.getByRole('heading', { name: earlier.heading })).toBeVisible()
            }
            await settle(page)
            expect(await problemsOn(page)).toEqual([])
          })
        }
      })
    })

    test.describe('signed out', () => {
      test.use({ storageState: { cookies: [], origins: [] } })

      test('the sign-in screen lays out cleanly', async ({ page }) => {
        await load(page, '/', phone.insets)
        await expect(page.getByRole('form', { name: 'Sign in' })).toBeVisible()
        expect(await problemsOn(page)).toEqual([])
      })

      test('the setup code and sign-in steps lay out cleanly', async ({ page }) => {
        // An install with no owner yet; the code is accepted without telling the server.
        await page.route('**/api/status', async (route) => {
          const status = await (await route.fetch()).json()
          await route.fulfill({ json: { ...status, hasOwner: false, onboarded: false } })
        })
        await page.route('**/api/auth/setup-code', (route) => route.fulfill({ status: 204 }))

        await load(page, '/', phone.insets)
        await expect(page.getByRole('heading', { name: 'Enter your setup code' })).toBeVisible()
        expect(await problemsOn(page)).toEqual([])

        await page.getByRole('textbox', { name: 'Setup code' }).fill(SETUP_CODE)
        await page.getByRole('button', { name: 'Continue' }).click()
        await expect(page.getByRole('heading', { name: 'Create your sign-in' })).toBeVisible()
        // Filled in, as the owner sees it just before creating the account.
        await page.getByRole('textbox', { name: 'Email' }).fill(OWNER.email)
        await settle(page)
        expect(await problemsOn(page)).toEqual([])
      })
    })
  })
}

test('every route the app answers has a screen in the guard', () => {
  const guarded = new Set(SCREENS.map((screen) => screen.route))
  const missing = Object.keys(ROUTES).filter((route) => !guarded.has(route as RouteName))
  expect(missing, 'Add a screen for each to SCREENS').toEqual([])
})

test.describe('in the widest theme, packed tight', () => {
  // Neon's Space Grotesk runs wider than the other themes' fonts, and compact
  // density takes away padding: together, the likeliest look to crowd a row.
  const phone = GUARDED_PHONES[0]!
  const NARROW_LOOK = [
    '/',
    '/accounts',
    '/transactions',
    '/budgets',
    '/plan',
    '/plan/goals',
    '/plan/retirement',
  ]
  test.use(phone.screen)

  const seeded: Seeded = emptySeed()
  test.beforeAll(async ({ request }) => {
    await seedEveryScreen(request, seeded)
  })
  test.afterAll(async ({ request }) => {
    await removeSeed(request, seeded)
    Object.assign(seeded, emptySeed())
  })

  const screens = [...NARROW_LOOK, ...SETTINGS_GROUPS.map((group) => `/settings/${group}`)].map(
    (path) => ({ name: path, path: () => path }),
  )
  screens.push({ name: 'a category page', path: () => `/budgets/${seeded.categories[0]}` })

  for (const screen of screens) {
    test(`${screen.name} lays out cleanly on ${phone.name}`, async ({ page }) => {
      // The look is changed on its way to the page, so the install keeps its own.
      await page.route('**/api/actions/get_settings', async (route) => {
        const { result } = await (await route.fetch()).json()
        const appearance = { ...result.appearance, theme: 'neon', density: 'compact' }
        await route.fulfill({ json: { result: { ...result, appearance } } })
      })
      await load(page, screen.path(), phone.insets)
      await expect(page.locator('html')).toHaveCSS('--pad', '16px')
      expect(await problemsOn(page)).toEqual([])
    })
  }
})
