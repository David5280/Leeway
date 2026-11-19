// Settings > AI models on a desktop: picking a model and setting the limit
// for real, the key notice, a month's spending and its alert, and the
// summary when the limit is reached. No test can reach a model: the server
// runs with no key, and spending is stood in for (see ai.ts).

import { expect, test } from '@playwright/test'
import { openAiModels, pretendBusyMonth, resetAi, SCREENSHOTS } from './ai'

test.afterEach(async ({ page }) => resetAi(page))

test('without a key it says one is needed, and the choices still save', async ({ page }) => {
  const section = await openAiModels(page)
  await expect(section).toContainText('AI needs an Anthropic API key, and none is set.')
  await expect(section.getByText('ANTHROPIC_API_KEY')).toBeVisible()
  await expect(section).toContainText('$0.00 of $5.00')

  // Each job starts on the small model.
  const paystub = section.getByRole('group', { name: 'Paystub reader' })
  await expect(paystub.getByRole('radio', { name: /^Claude Haiku/ })).toBeChecked()
  // A click, not check(): the list is held while the pick saves.
  await paystub.getByRole('radio', { name: /^Claude Sonnet/ }).click()
  await expect(paystub.getByRole('radio', { name: /^Claude Sonnet/ })).toBeChecked()
  await expect(paystub.getByRole('radio', { name: /^Claude Sonnet/ })).toBeEnabled()

  const limit = section.getByRole('textbox', { name: 'Monthly limit in US dollars' })
  await limit.fill('12.50')
  await section.getByRole('button', { name: 'Save' }).click()
  await expect(section.getByText('Limit saved.')).toBeVisible()

  // Both are kept by the server.
  await page.reload()
  await expect(paystub.getByRole('radio', { name: /^Claude Sonnet/ })).toBeChecked()
  await expect(
    section.getByRole('group', { name: 'Dashboard summary' }).getByRole('radio', {
      name: /^Claude Haiku/,
    }),
  ).toBeChecked()
  await expect(limit).toHaveValue('12.50')
  await expect(section).toContainText('$0.00 of $12.50')
})

test('turns away a limit over $1,000 before it is sent', async ({ page }) => {
  const section = await openAiModels(page)
  const sent: string[] = []
  page.on('request', (request) => {
    if (request.url().endsWith('/set_ai_limit')) sent.push(request.url())
  })
  await section.getByRole('textbox', { name: 'Monthly limit in US dollars' }).fill('2000')
  await section.getByRole('button', { name: 'Save' }).click()
  await expect(section.getByRole('alert')).toHaveText('Use $1,000.00 or less.')
  expect(sent).toEqual([])
})

test("shows a month's spending against the limit, and the warning until dismissed", async ({
  page,
}) => {
  await pretendBusyMonth(page)
  const section = await openAiModels(page)
  await expect(section).not.toContainText('none is set')
  const ring = section.getByRole('progressbar', { name: 'AI spending against the limit' })
  await expect(ring).toHaveAttribute('aria-valuenow', '82')
  await expect(section).toContainText('$4.10 of $5.00')
  await expect(section).toContainText('38 calls this month.')
  await expect(section.getByRole('list', { name: 'Spending by job' })).toContainText(
    'Paystub reader$0.50, 2 calls',
  )
  const warning = section.getByText(/AI has spent \$4\.10/)
  await expect(warning).toBeVisible()

  if (SCREENSHOTS) {
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.screenshot({ path: `${SCREENSHOTS}/settings-ai-desktop.png`, fullPage: true })
  }

  await section.getByRole('button', { name: 'Dismiss the AI spending alert' }).click()
  await expect(warning).toBeHidden()
})

test('the overview says when the limit is why Leeway wrote the summary', async ({ page }) => {
  await pretendBusyMonth(page)
  await page.route('**/api/actions/get_summary', async (route) => {
    const response = await route.fetch()
    const { result } = await response.json()
    const limited = { ...result, ai: 'limit', limitResetsOn: '2026-12-01' }
    await route.fulfill({ response, json: { result: limited } })
  })
  await page.goto('/')
  const summary = page.getByRole('region', { name: 'Summary' })
  await expect(summary).toContainText(
    "This month's AI limit is reached, so this is Leeway's own summary until Dec 1.",
  )
  // The warning shows in Heads up too, with the way to AI models.
  const headsUp = page.getByRole('region', { name: 'Heads up' })
  await expect(headsUp).toContainText('AI has spent $4.10')
  await headsUp.getByRole('link', { name: 'AI models' }).click()
  await expect(page).toHaveURL(/\/settings\/ai$/)
})
