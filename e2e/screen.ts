// What the phone layout guard (layout-guard.phone.spec.ts) checks on each
// screen, and the steps the screen lists (guarded-screens.ts and the files
// beside it) share: naming a route, opening a form, and waiting for it to settle.

import { expect, type APIRequestContext, type Page } from '@playwright/test'
import type { RouteName } from '../web/src/routes'
import type { GuardedPhone } from './phone'
import type { Seeded } from './seed'

export interface Screen {
  name: string
  /** The route in web/src/routes.ts this screen is an address of. */
  route: RouteName
  /** The address, worked out from what was seeded (an assistant's needs the server). */
  path: (seeded: Seeded, request: APIRequestContext) => string | Promise<string>
  /** Anything to set up before it loads, like standing in for a service the tests cannot reach. */
  before?: (page: Page) => Promise<void>
  /** Anything to do once it has loaded, like opening a form. */
  then?: (page: Page) => Promise<void>
  /** Only on the phones this holds for; by default, on every phone. */
  on?: (phone: GuardedPhone) => boolean
}

export const at = (route: RouteName, path: string, more: Partial<Screen> = {}): Screen => ({
  name: path,
  route,
  path: () => path,
  ...more,
})

/**
 * Presses a button, then waits for what it opens. The button is scrolled into
 * view a frame ahead, as a finger would find it first, so the scroll is over
 * before the press: a menu closes when the page or its row scrolls.
 */
export const open = (
  button: string | RegExp,
  opens: (page: Page) => ReturnType<Page['getByRole']>,
) =>
  async function (page: Page) {
    const pressed = page.getByRole('button', { name: button }).first()
    await pressed.scrollIntoViewIfNeeded()
    await page.evaluate(
      () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
    )
    await pressed.click()
    await expect(opens(page)).toBeVisible()
  }

/** Waits until nothing in it is still moving, like a sheet sliding up. */
export async function stillOn(locator: ReturnType<Page['getByRole']>) {
  await expect.poll(() => locator.evaluate((element) => element.getAnimations().length)).toBe(0)
}
