// Helpers for Settings > AI models. The browser tests run with no Anthropic
// key, so no model can ever be called. Picking models and setting the limit
// run for real; a month of spending, which only real calls make, is stood in
// for at the network by patching what get_ai_usage answers.

import type { Page } from '@playwright/test'

/**
 * A folder to save pictures of Settings > AI models in, for review. Unset in
 * CI: the tests then only check.
 */
export const SCREENSHOTS = process.env.AI_SCREENSHOTS

/** Opens Settings > AI models and returns its card. */
export async function openAiModels(page: Page) {
  await page.goto('/settings/ai')
  return page.getByRole('region', { name: 'AI models' })
}

/** A month in which the key is set and AI has spent $4.10 of the $5.00 limit. */
const BUSY_MONTH = {
  keySet: true,
  provider: 'Claude',
  spentMicros: 4_100_000,
  calls: 38,
  spend: {
    summary: { calls: 36, costMicros: 3_600_000 },
    paystub: { calls: 2, costMicros: 500_000 },
  },
  alert: {
    level: 'warning',
    message: "AI has spent $4.10 of this month's $5.00 limit. It resets on Dec 1.",
  },
}

/**
 * Makes get_ai_usage answer as if the key were set and AI had spent $4.10
 * this month, with the 80% warning until it is dismissed. Everything else in
 * the answer, the models and the limit included, is the real server's.
 */
export async function pretendBusyMonth(page: Page): Promise<void> {
  let dismissed = false
  await page.route('**/api/actions/dismiss_ai_alert', async (route) => {
    dismissed = true
    await route.continue()
  })
  await page.route('**/api/actions/get_ai_usage', async (route) => {
    const response = await route.fetch()
    const { result } = await response.json()
    const jobs = result.jobs.map((job: { job: 'summary' | 'paystub' }) => ({
      ...job,
      spend: BUSY_MONTH.spend[job.job],
    }))
    const patched = {
      ...result,
      keySet: BUSY_MONTH.keySet,
      provider: BUSY_MONTH.provider,
      spentMicros: BUSY_MONTH.spentMicros,
      calls: BUSY_MONTH.calls,
      jobs,
      alert: dismissed ? null : BUSY_MONTH.alert,
    }
    await route.fulfill({ response, json: { result: patched } })
  })
}

/** Puts the models and the limit back as a new install has them, since later specs share it. */
export async function resetAi(page: Page): Promise<void> {
  for (const job of ['summary', 'paystub']) {
    await page.request.post('/api/actions/set_ai_model', { data: { job, model: null } })
  }
  await page.request.post('/api/actions/set_ai_limit', { data: { monthlyCapCents: 500 } })
}
