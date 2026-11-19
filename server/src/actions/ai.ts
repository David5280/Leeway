// Actions for the owner's AI choices: the model each job uses, the monthly
// spending limit, and this month's usage.
//
// All are app-only. Picking a model or the limit decides what is spent on the
// owner's own Anthropic account, which is theirs to decide, never an agent's.
// Reading usage would be harmless for an agent, as it holds counts and costs
// only, but nothing an assistant does for the owner needs it, so it stays in
// the app with the controls it explains. An agent still sees the chosen
// models and the limit in get_settings.

import { z } from 'zod'
import { AI_JOBS } from '../ai/jobs.js'
import { MODEL_IDS } from '../ai/models.js'
import { clearSpendAlerts, dismissSpendAlerts } from '../domain/ai/alerts.js'
import { aiMonth } from '../domain/ai/month.js'
import { aiUsageReport } from '../domain/ai/report.js'
import { monthlyCapSchema } from '../domain/ai/settings.js'
import { getSettings, saveSettings } from '../domain/settings.js'
import { defineAction } from './action.js'

export const getAiUsageAction = defineAction({
  name: 'get_ai_usage',
  title: 'AI models and usage',
  description:
    "Whether the server has an Anthropic key, the model each AI job uses and where that choice comes from, the models to pick from with their prices, and this month's AI spending against the monthly limit, in all and by job, with any spending alert. Costs are in millionths of a US dollar.",
  input: z.object({}),
  scope: 'read',
  surface: 'app',
  run: async (ctx) => aiUsageReport(ctx, await getSettings(ctx.db)),
})

export const setAiModelAction = defineAction({
  name: 'set_ai_model',
  title: 'Choose the model for an AI job',
  description:
    'Sets the model an AI job uses. null goes back to the job default. A server variable such as PAYSTUB_MODEL still wins.',
  input: z.object({ job: z.enum(AI_JOBS), model: z.enum(MODEL_IDS).nullable() }),
  scope: 'write',
  surface: 'app',
  run: async (ctx, { job, model }) => {
    const settings = await getSettings(ctx.db)
    const models = { ...settings.ai.models, [job]: model }
    await saveSettings(ctx.db, { ...settings, ai: { ...settings.ai, models } })
    return aiUsageReport(ctx, await getSettings(ctx.db))
  },
})

export const setAiLimitAction = defineAction({
  name: 'set_ai_limit',
  title: 'Set the monthly AI limit',
  description:
    "Sets the most AI calls may spend in a month, in US cents. 0 stops every paid AI call. This month's spending alerts start over against the new limit.",
  input: z.object({ monthlyCapCents: monthlyCapSchema }),
  scope: 'write',
  surface: 'app',
  run: async (ctx, { monthlyCapCents }) => {
    const settings = await getSettings(ctx.db)
    await saveSettings(ctx.db, { ...settings, ai: { ...settings.ai, monthlyCapCents } })
    await clearSpendAlerts(ctx.db, aiMonth(ctx.now(), settings.timeZone).start)
    return aiUsageReport(ctx, await getSettings(ctx.db))
  },
})

export const dismissAiAlertAction = defineAction({
  name: 'dismiss_ai_alert',
  title: 'Dismiss the AI spending alert',
  description: "Hides this month's AI spending alerts. The limit itself still holds.",
  input: z.object({}),
  scope: 'write',
  surface: 'app',
  run: async (ctx) => {
    const settings = await getSettings(ctx.db)
    const month = aiMonth(ctx.now(), settings.timeZone)
    await dismissSpendAlerts(ctx.db, month.start, ctx.now())
    return { dismissed: true }
  },
})
