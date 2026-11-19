// The phone layout guard: every screen, on an iPhone and the narrowest iPhone,
// upright and turned sideways, installed to the home screen, with lists full
// of long names. Each screen must have no text over other text or controls,
// no text cut off without an ellipsis, no word split across lines, no
// sideways scrolling, and nothing showing under the status bar, the notch or
// the home indicator. The checks themselves are in layout.ts.

import { createHash, randomBytes } from 'node:crypto'
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { describeProblems, findProblems, layoutProblems, type LayoutProblem } from './layout'
import { OWNER, SETUP_CODE } from './owner'
import { GUARDED_PHONES, simulateInsets, type Insets } from './phone'
import { action, emptySeed, removeSeed, seedEveryScreen, type Seeded } from './seed'

/** The Settings menu's groups, in order (web/src/pages/settings/groups.tsx). */
const SETTINGS_GROUPS = [
  'appearance',
  'budgeting',
  'accounts',
  'banks',
  'email',
  'assistant',
  'data',
  'sign-in',
]

interface Screen {
  name: string
  /** The address, worked out from what was seeded. */
  path: (seeded: Seeded) => string
  /** Anything to do once it has loaded, like opening the layout editor. */
  then?: (page: Page) => Promise<void>
}

const at = (path: string): Screen => ({ name: path, path: () => path })

/** Every screen in the app's router (App.tsx) once setup is done. */
const SCREENS: Screen[] = [
  at('/'),
  {
    name: '/ while editing its layout',
    path: () => '/',
    then: async (page) => {
      const edit = page.getByRole('button', { name: 'Edit layout' })
      // Phone-sized screens arrange the overview in Settings instead.
      test.skip(!(await edit.isVisible()), 'The overview is only edited in place on wider screens')
      await edit.click()
    },
  },
  at('/accounts'),
  ...['checking', 'savings', 'credit card', 'loan'].map((kind, index) => ({
    name: `the ${kind} account page`,
    path: (seeded: Seeded) => `/accounts?select=${seeded.accounts[index]}`,
  })),
  at('/alerts'),
  at('/transactions'),
  {
    name: "one account's transactions",
    path: (seeded) => `/transactions?account=${seeded.accounts[0]}`,
  },
  at('/transactions/import'),
  at('/budgets'),
  { name: 'a category page', path: (seeded) => `/budgets/${seeded.categories[0]}` },
  at('/plan'),
  at('/plan/goals'),
  at('/plan/debts'),
  at('/plan/net-worth'),
  ...SETTINGS_GROUPS.map((group) => at(`/settings/${group}`)),
  at('/connect'),
]

/** A sign-in screen an assistant is sent to, as Claude would be (see connect.spec.ts). */
async function connectAddress(request: APIRequestContext): Promise<string> {
  const callback = 'http://127.0.0.1:33418/callback'
  const server = await (await request.get('/.well-known/oauth-authorization-server')).json()
  const resource = await (await request.get('/.well-known/oauth-protected-resource/mcp')).json()
  const app = await (
    await request.post('/oauth/register', {
      data: { client_name: 'Claude on the laptop upstairs', redirect_uris: [callback] },
    })
  ).json()
  const verifier = randomBytes(32).toString('base64url')
  const address = new URL(server.authorization_endpoint)
  address.search = new URLSearchParams({
    response_type: 'code',
    client_id: app.client_id,
    redirect_uri: callback,
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
    state: 'layout-guard',
    scope: 'read write',
    resource: resource.resource,
  }).toString()
  return address.toString()
}

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
 * Every layout problem on the screen: all checks at the top, then the safe
 * areas again scrolled halfway, where content has moved under the status bar,
 * and at the end, where the last content must also rest clear of the tab bar.
 */
async function problemsOn(page: Page): Promise<string[]> {
  const problems: LayoutProblem[] = await layoutProblems(page)
  for (const [share, checks] of [
    [0.5, ['safe-area']],
    [1, ['safe-area', 'overlap']],
  ] as const) {
    await page.evaluate((to) => {
      window.scrollTo(0, (document.documentElement.scrollHeight - window.innerHeight) * to)
    }, share)
    await page.evaluate(() => new Promise((done) => requestAnimationFrame(done)))
    for (const check of checks) problems.push(...(await findProblems(page, check)))
  }
  // Each problem once, however many scroll positions found it.
  return [...new Set(describeProblems(problems))]
}

/** Loads a screen as an installed app on this phone draws it, ready to check. */
async function open(page: Page, path: string, insets: Insets): Promise<void> {
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

      for (const screen of SCREENS) {
        test(`${screen.name} lays out cleanly`, async ({ page }) => {
          await open(page, screen.path(seeded), phone.insets)
          if (screen.then) {
            await screen.then(page)
            await settle(page)
          }
          expect(await problemsOn(page)).toEqual([])
        })
      }

      test("an assistant's connect screen lays out cleanly", async ({ page, request }) => {
        await open(page, await connectAddress(request), phone.insets)
        await expect(page.getByRole('heading', { name: /^Connect .+ to Leeway\?$/ })).toBeVisible()
        expect(await problemsOn(page)).toEqual([])
      })

      test('the Settings menu has every group the guard visits', async ({ page }) => {
        await open(page, '/settings/appearance', phone.insets)
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
            await open(page, '/', phone.insets)
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
        await open(page, '/', phone.insets)
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

        await open(page, '/', phone.insets)
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
