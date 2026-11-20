// Actions for the dashboard summary, and the owner's switch for Claude writing it.

import { z } from 'zod'
import { getSettings, saveSettings } from '../domain/settings.js'
import { getSummary } from '../domain/summary.js'
import { defineAction } from './action.js'
import { settingsAndToday } from './today.js'

export const getSummaryAction = defineAction({
  name: 'get_summary',
  title: 'Dashboard summary',
  description:
    'The summary on the dashboard: a headline on how this budget period is going and up to four short points, in plain words. writtenBy is "Leeway" or the AI that wrote it. For the numbers behind it, use get_checkin.',
  input: z.object({}),
  scope: 'read',
  surface: 'all',
  run: async (ctx) => {
    const { settings, today } = await settingsAndToday(ctx)
    return getSummary(ctx, settings, today)
  },
})

/**
 * App only: turning this on sends a daily summary of the owner's numbers to
 * Anthropic, so it is the owner's choice alone, never an agent's.
 */
export const setAiSummaryAction = defineAction({
  name: 'set_ai_summary',
  title: 'Turn the AI summary on or off',
  description:
    'Whether Claude writes the dashboard summary. Needs ANTHROPIC_API_KEY on the server.',
  input: z.object({ on: z.boolean() }),
  scope: 'write',
  surface: 'app',
  run: async (ctx, { on }) => {
    const settings = await getSettings(ctx.db)
    return saveSettings(ctx.db, { ...settings, aiSummary: on })
  },
})
