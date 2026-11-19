// Helpers for Settings > AI models. The browser tests run with no Anthropic
// key, so no model can ever be called. Picking models and setting the limit
// run for real; what only real calls bring about (a month of spending, a
// model Anthropic no longer has) is stood in for at the network, by patching
// what get_ai_usage and get_summary answer.

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

/** An action's answer, as the real server gave it. */
type Answer = Record<string, unknown>
/** One job in get_ai_usage's answer. */
type Job = { job: 'summary' | 'paystub' } & Answer

/** Answers an action with the real server's answer, changed by `change`. */
async function patchAnswer(page: Page, action: string, change: (result: Answer) => Answer) {
  await page.route(`**/api/actions/${action}`, async (route) => {
    const response = await route.fetch()
    const { result } = await response.json()
    await route.fulfill({ response, json: { result: change(result) } })
  })
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
  await patchAnswer(page, 'get_ai_usage', (result) => ({
    ...result,
    keySet: BUSY_MONTH.keySet,
    provider: BUSY_MONTH.provider,
    spentMicros: BUSY_MONTH.spentMicros,
    calls: BUSY_MONTH.calls,
    jobs: (result.jobs as Job[]).map((job) => ({ ...job, spend: BUSY_MONTH.spend[job.job] })),
    alert: dismissed ? null : BUSY_MONTH.alert,
  }))
}

/** A model id Anthropic no longer has and Leeway has no prices for, long as dated ids are. */
export const GONE_MODEL = 'claude-retired-model-of-old-20240101'
/** The day the paystub reader's model retires, in pretendModelTrouble. */
export const RETIRES_ON = '2026-11-30'

/**
 * Makes get_ai_usage answer as if the summary's model were gone and unpriced,
 * and the paystub reader's retiring on RETIRES_ON, so both notices show.
 */
export async function pretendModelTrouble(page: Page): Promise<void> {
  const trouble: Record<Job['job'], Answer> = {
    summary: { model: GONE_MODEL, unavailable: true, priced: false, retiresOn: null },
    paystub: { retiresOn: RETIRES_ON },
  }
  await patchAnswer(page, 'get_ai_usage', (result) => ({
    ...result,
    jobs: (result.jobs as Job[]).map((job) => ({ ...job, ...trouble[job.job] })),
  }))
}

/** Makes get_summary answer as if Anthropic had no model for the summary, so Leeway wrote it. */
export async function pretendSummaryModelGone(page: Page): Promise<void> {
  await patchAnswer(page, 'get_summary', (result) => ({ ...result, ai: 'no_model' }))
}

/** Puts the models and the limit back as a new install has them, since later specs share it. */
export async function resetAi(page: Page): Promise<void> {
  for (const job of ['summary', 'paystub']) {
    await page.request.post('/api/actions/set_ai_model', { data: { job, model: null } })
  }
  await page.request.post('/api/actions/set_ai_limit', { data: { monthlyCapCents: 500 } })
}
