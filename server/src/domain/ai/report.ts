// What Settings shows about AI: the model each job uses, the models to pick
// from, and this month's spending against the limit, with any alert.

import { AI_JOBS, JOB_INFO, type AiJob } from '../../ai/jobs.js'
import { MODEL_CHOICES, isPriced, retiresOn } from '../../ai/models.js'
import type { AppContext } from '../../context.js'
import type { IsoDate } from '../../lib/dates.js'
import type { Settings } from '../settings.js'
import { activeSpendAlert, spendAlertMessage, type SpendAlertLevel } from './alerts.js'
import { aiMonth } from './month.js'
import { resolveModel, type ModelSource } from './settings.js'
import { unavailableModels } from './unavailable.js'
import { monthSpend, type JobSpend } from './usage.js'

export interface JobReport {
  job: AiJob
  title: string
  description: string
  model: string
  source: ModelSource
  /** The variable that would fix the model on the server. */
  envVar: string
  defaultModel: string
  /** False for a model Leeway has no prices for, which is counted at the dearest prices. */
  priced: boolean
  /** True once Anthropic said it has no such model, until a call with it works. */
  unavailable: boolean
  /** The day Anthropic retires the model, or null when none is announced. */
  retiresOn: IsoDate | null
  spend: JobSpend
}

export interface SpendAlert {
  level: SpendAlertLevel
  message: string
}

export interface AiUsageReport {
  /** Whether the server has an Anthropic key; without one, no AI job runs. */
  keySet: boolean
  /** Who answers, like "Claude", or null without a key. */
  provider: string | null
  models: typeof MODEL_CHOICES
  jobs: JobReport[]
  monthlyCapCents: number
  /** This month's spend, in millionths of a dollar. */
  spentMicros: number
  calls: number
  /** The first day of this month on the owner's clock, and the day the limit resets. */
  month: { start: IsoDate; resetsOn: IsoDate }
  alert: SpendAlert | null
}

export async function aiUsageReport(ctx: AppContext, settings: Settings): Promise<AiUsageReport> {
  const month = aiMonth(ctx.now(), settings.timeZone)
  const [spend, level, missing] = await Promise.all([
    monthSpend(ctx.db, month),
    activeSpendAlert(ctx.db, month.start),
    unavailableModels(ctx.db),
  ])
  const jobs = AI_JOBS.map((job): JobReport => {
    const { model, source } = resolveModel(job, settings.ai, ctx.config.modelOverrides)
    const info = JOB_INFO[job]
    return {
      job,
      title: info.title,
      description: info.description,
      model,
      source,
      envVar: info.envVar,
      defaultModel: info.defaultModel,
      priced: isPriced(model),
      unavailable: missing.has(model),
      retiresOn: retiresOn(model),
      spend: spend.byJob[job] ?? { calls: 0, costMicros: 0 },
    }
  })
  return {
    keySet: ctx.ai !== null,
    provider: ctx.ai?.name ?? null,
    models: MODEL_CHOICES,
    jobs,
    monthlyCapCents: settings.ai.monthlyCapCents,
    spentMicros: spend.totalMicros,
    calls: spend.calls,
    month: { start: month.start, resetsOn: month.resetsOn },
    alert: level
      ? { level, message: spendAlertMessage(level, spend.totalMicros, settings, month.resetsOn) }
      : null,
  }
}
