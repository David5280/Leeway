// The owner's AI choices: a model for each job and a monthly spending limit.
// Kept in the settings document, but only the owner changes them, in the app
// (actions/ai.ts), so they are left out of settingsPatchSchema.

import { z } from 'zod'
import { JOB_INFO, type AiJob } from '../../ai/jobs.js'
import { MODEL_IDS } from '../../ai/models.js'

/** A limit that covers years of the summary and paystubs on the small model. */
export const DEFAULT_MONTHLY_CAP_CENTS = 500

/** The highest limit the app takes: $1,000 a month. */
export const MAX_MONTHLY_CAP_CENTS = 100_000

/** The share of the limit at which the owner is warned, once a month. */
export const WARN_AT_PERCENT = 80

/**
 * A job's model as the owner picked it; null follows the job's default. A
 * model taken off the list since falls back to the default, keeping the rest.
 */
const modelPick = z.enum(MODEL_IDS).nullable().catch(null)

export const monthlyCapSchema = z
  .number()
  .int('Use whole cents')
  .min(0, 'Use $0 or more')
  .max(MAX_MONTHLY_CAP_CENTS, 'Use $1,000 or less')

export const aiSettingsSchema = z.object({
  models: z
    .object({ summary: modelPick.default(null), paystub: modelPick.default(null) })
    .default({ summary: null, paystub: null }),
  monthlyCapCents: monthlyCapSchema
    .catch(DEFAULT_MONTHLY_CAP_CENTS)
    .default(DEFAULT_MONTHLY_CAP_CENTS),
})

export type AiSettings = z.infer<typeof aiSettingsSchema>

/** Where a job's model comes from: a server variable, the owner's pick, or the default. */
export type ModelSource = 'server' | 'owner' | 'default'

/**
 * The model a job uses. A server variable such as PAYSTUB_MODEL wins, as it
 * always has; then the owner's pick in Settings; then the job's small default.
 */
export function resolveModel(
  job: AiJob,
  ai: AiSettings,
  overrides: Record<AiJob, string | null>,
): { model: string; source: ModelSource } {
  const fixed = overrides[job]
  if (fixed) return { model: fixed, source: 'server' }
  const picked = ai.models[job]
  if (picked) return { model: picked, source: 'owner' }
  return { model: JOB_INFO[job].defaultModel, source: 'default' }
}
