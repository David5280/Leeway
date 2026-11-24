// Chat on a phone, upright, narrowest and turned sideways: the conversation,
// the box to type in and what Leeway remembers stay inside the screen, the
// box stays clear of the tab bar, and every control is at least 44px tall.
// Ask Leeway's logo button sits in the corner above the tabs, clear of
// them, and opens a box inside the screen, which a tap outside shrinks back
// into the button with the page where it was.
// Chat is turned on by stand-ins (chat.ts); no model is called.

import { expect, test, type Page } from '@playwright/test'
import { askStarter, openChat, pretendChatOn } from './chat'
import { boxes, overflow, overlapping, PHONES } from './phone'

/**
 * A spot on the page outside Ask Leeway's box where a tap does nothing but
 * close it: words or empty space, not a link, button or field.
 */
async function quietSpotOutside(page: Page): Promise<{ x: number; y: number }> {
  const spot = await page.evaluate(() => {
    const taps = 'a, button, input, select, textarea, summary, label, [tabindex], [data-ask-hold]'
    for (let y = 8; y < window.innerHeight; y += 16) {
      for (let x = 8; x < window.innerWidth; x += 16) {
        const at = document.elementFromPoint(x, y)
        if (at && !at.closest('.ask-box') && !at.closest(taps)) return { x, y }
      }
    }
    return null
  })
  expect(spot).not.toBeNull()
  return spot!
}

for (const [name, viewport] of PHONES) {
  test.describe(`on ${name}`, () => {
    test.use({ viewport, isMobile: true, hasTouch: true })

    test('Chat fits, with 44px targets and the box above the tab bar', async ({ page }) => {
      await pretendChatOn(page)
      await openChat(page)
      for (const starter of await boxes(page.locator('.chat-starter'))) {
        expect(starter.x + starter.width).toBeLessThanOrEqual(viewport.width)
        expect(starter.height).toBeGreaterThanOrEqual(44)
      }
      await askStarter(page)
      await page.getByText('Leeway remembers 2 things').click()
      expect(await overflow(page)).toBeLessThanOrEqual(0)

      const targets = page.locator('.chat button, .chat summary, .chat textarea')
      for (const box of await boxes(targets)) expect(box.height).toBeGreaterThanOrEqual(44)

      // Scrolled to the end, the box to type in rests above the tab bar.
      await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight }))
      const composer = (await page.locator('.chat-composer').boundingBox())!
      // Turned sideways there is no tab bar at all (the tabs are in the top row).
      const bar = page.locator('.tabbar')
      const tabbar = (await bar.count()) > 0 ? await bar.boundingBox() : null
      if (tabbar) expect(overlapping(composer, tabbar)).toBe(false)
      const lines = await boxes(page.locator('.chat-line'))
      for (const [i, a] of lines.entries()) {
        expect(a.x + a.width).toBeLessThanOrEqual(viewport.width)
        for (const b of lines.slice(i + 1)) expect(overlapping(a, b)).toBe(false)
      }
    })

    test('Ask Leeway sits above the tabs and opens a box inside the screen', async ({ page }) => {
      await pretendChatOn(page)
      await page.goto('/payday')
      const askButton = page.getByRole('button', { name: 'Ask Leeway' })
      const button = (await askButton.boundingBox())!
      expect(button.height).toBeGreaterThanOrEqual(44)
      expect(button.x + button.width).toBeLessThanOrEqual(viewport.width)
      const tabs = page.locator('.tabbar')
      const tabbar = (await tabs.count()) > 0 ? await tabs.boundingBox() : null
      if (tabbar) expect(overlapping(button, tabbar)).toBe(false)

      await page.evaluate(() => window.scrollTo({ top: 200 }))
      const scrolled = await page.evaluate(() => window.scrollY)
      await askButton.click()
      const box = page.getByRole('dialog', { name: 'Ask Leeway' })
      await expect(box.getByRole('textbox', { name: 'Your question' })).toBeFocused()
      // Measured once it has grown from the corner, not partway through.
      await box.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)))
      // Inside the screen, clear of the tab bar, its field and close button full taps.
      const opened = (await box.boundingBox())!
      expect(opened.x).toBeGreaterThanOrEqual(0)
      expect(opened.y).toBeGreaterThanOrEqual(0)
      expect(opened.x + opened.width).toBeLessThanOrEqual(viewport.width)
      expect(opened.y + opened.height).toBeLessThanOrEqual(viewport.height)
      if (tabbar) expect(overlapping(opened, tabbar)).toBe(false)
      const targets = box.locator('.chat-foot textarea, .ask-box-close')
      for (const target of await boxes(targets)) expect(target.height).toBeGreaterThanOrEqual(44)

      // A tap on the page outside it shrinks it back, the page where it was.
      const outside = await quietSpotOutside(page)
      await page.mouse.click(outside.x, outside.y)
      await expect(box).toHaveCount(0)
      await expect(askButton).toBeVisible()
      await expect(page).toHaveURL(/\/payday$/)
      expect(await page.evaluate(() => window.scrollY)).toBe(scrolled)
    })
  })
}
