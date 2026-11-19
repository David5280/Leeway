// The widget's three sizes, drawn in a browser from the script's own layouts:
// with a calm month, a hard one and a problem message, in light and dark,
// nothing spills out of the widget and no one-line text is cut short.

import { expect, test } from '@playwright/test'
import { troubledWidgetSummary, widgetSummary } from '../web/src/test/widget'
import { SCREENSHOTS } from './widget'
import { loadWidgetScript, previewPage, SIZES } from './widgetPreview'

const FAMILIES = ['small', 'medium', 'large'] as const

test('the widget previews fit at every size, in light and dark', async ({ page }) => {
  const script = await loadWidgetScript()
  // Night, following the device, so the light and dark pages differ.
  const calm = widgetSummary({ appearance: { theme: 'night', mode: 'system' } })
  const hard = { ...troubledWidgetSummary(), appearance: calm.appearance }
  const widgets = [
    ...FAMILIES.map((family) => ({
      title: family,
      layout: script.layoutFor(family, calm, 'America/Denver'),
    })),
    ...FAMILIES.map((family) => ({
      title: `${family}, a hard month`,
      layout: script.layoutFor(family, hard, 'America/Denver'),
    })),
    { title: 'small, offline', layout: script.messageLayout('offline', 'small') },
    { title: 'medium, token revoked', layout: script.messageLayout('bad_token', 'medium') },
  ]
  await page.setViewportSize({ width: 1240, height: 900 })

  for (const mode of ['light', 'dark'] as const) {
    await page.setContent(previewPage(widgets, mode, script))
    await expect(page.getByRole('heading', { name: 'Leeway widget: previews' })).toBeVisible()

    const drawn = page.locator('.widget')
    await expect(drawn).toHaveCount(widgets.length)
    for (const [i, widget] of (await drawn.all()).entries()) {
      const family = widgets[i]!.layout.family
      expect(await widget.boundingBox()).toMatchObject(SIZES[family])
      // Everything fits inside, and every one-line text fits across once shrunk.
      const spill = await widget.evaluate((element) => {
        const inner = element.querySelector('.inner')!
        const tooWide = [...element.querySelectorAll<HTMLElement>('.text.one-line')]
          .filter((text) => text.scrollWidth > text.clientWidth + 1)
          .map((text) => text.textContent)
        return { down: inner.scrollHeight - inner.clientHeight, tooWide }
      })
      expect(spill, widgets[i]!.title).toEqual({ down: 0, tooWide: [] })
    }

    if (SCREENSHOTS) {
      await page.screenshot({ path: `${SCREENSHOTS}/preview-all-${mode}.png`, fullPage: true })
      for (const [i, family] of FAMILIES.entries()) {
        await page
          .locator('figure')
          .nth(i)
          .screenshot({ path: `${SCREENSHOTS}/preview-${family}-${mode}.png` })
      }
    }
  }
})
