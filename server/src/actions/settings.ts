// Actions to read and change settings: period, region, warnings, look and layout.

import { z } from 'zod'
import {
  getSettings,
  mergeSettings,
  saveSettings,
  settingsPatchSchema,
} from '../domain/settings.js'
import { defineAction } from './action.js'

export const getSettingsAction = defineAction({
  name: 'get_settings',
  title: 'Get settings',
  description:
    'Read all preferences: budget period (monthly, weekly or per paycheck), time zone, currency, warning threshold, appearance, dashboard layout and the savings plan (emergency fund target in months, and which spending categories count as essential: null finds them from each category, counting housing, utilities, groceries, transport, health, insurance and loan payments; and goalsMonthlyCents, what goes to goals each month).',
  input: z.object({}),
  scope: 'read',
  surface: 'all',
  run: (ctx) => getSettings(ctx.db),
})

export const updateSettingsAction = defineAction({
  name: 'update_settings',
  title: 'Update settings',
  description:
    'Change any preferences. Only the fields given change. appearance and savingsPlan merge field by field (savingsPlan: emergencyFundMonths 1 to 24, essentialCategoryIds where null finds the essential categories from their names and bank codes, savingsRateTargetPercent where null sets no target, goalsMonthlyCents: what goes to goals each month, filling them in their order, where null uses the pace Leeway sees) and retirement merge field by field (retirement: birthYear, retirementAge, returnPercent, inflationPercent, withdrawalPercent, monthlyContributionCents where null uses what Leeway found, targetMonthlyIncomeCents where null uses recent spending); period and dashboard.widgets replace the whole value.',
  input: settingsPatchSchema,
  scope: 'write',
  surface: 'all',
  run: async (ctx, patch) => saveSettings(ctx.db, mergeSettings(await getSettings(ctx.db), patch)),
})
