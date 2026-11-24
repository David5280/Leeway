// Chat on a phone, upright, narrowest and turned sideways: the conversation,
// the box to type in and what Leeway remembers stay inside the screen, the
// box stays clear of the tab bar, and every control is at least 44px tall.
// Chat is turned on by stand-ins (chat.ts); no model is called.

import { expect, test } from '@playwright/test'
import { askStarter, openChat, pretendChatOn } from './chat'
import { boxes, overflow, overlapping, PHONES } from './phone'

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
  })
}
