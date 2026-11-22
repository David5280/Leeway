// Actions to read and change settings: period, region, warnings, look and layout.

import { z } from 'zod'
import { checkBirthYear } from '../domain/retirement/assumptions.js'
import {
  getSettings,
  mergeSettings,
  saveSettings,
  settingsPatchSchema,
} from '../domain/settings.js'
import { todayIn } from '../lib/dates.js'
import { defineAction } from './action.js'

export const getSettingsAction = defineAction({
  name: 'get_settings',
  title: 'Get settings',
  description:
    'Read all preferences: budget period (monthly, weekly or per paycheck), time zone, currency, warning threshold, appearance, dashboard layout and the savings plan (emergency fund target in months, and which spending categories count as essential: null finds them from the bank codes or name of each category, counting housing, utilities, groceries, transport, health, insurance, child care and fixed loan payments, never credit card payments, with a loan or child care payment filed in another category counted by its own bank code; a list counts exactly those categories, whole).',
  input: z.object({}),
  scope: 'read',
  surface: 'all',
  run: (ctx) => getSettings(ctx.db),
})

export const updateSettingsAction = defineAction({
  name: 'update_settings',
  title: 'Update settings',
  description:
    'Change any preferences. Only the fields given change. appearance and savingsPlan merge field by field (savingsPlan: emergencyFundMonths 1 to 24, essentialCategoryIds where null finds the essential categories from their names and bank codes and counts essential payments filed elsewhere by their own bank code, and a list counts exactly those categories, whole, savingsRateTargetPercent where null sets no target) and retirement merge field by field (retirement: birthYear from 110 years back to this year, retirementAge, returnPercent, inflationPercent, withdrawalPercent, monthlyContributionCents where null uses what Leeway found, targetMonthlyIncomeCents where null uses recent spending); period and dashboard.widgets replace the whole value.',
  input: settingsPatchSchema,
  scope: 'write',
  surface: 'all',
  run: async (ctx, patch) => {
    const settings = mergeSettings(await getSettings(ctx.db), patch)
    // Today where the owner lives, after any time zone change in the same patch.
    const today = todayIn(settings.timeZone, ctx.now())
    checkBirthYear(patch.retirement?.birthYear, today, 'retirement.birthYear')
    return saveSettings(ctx.db, settings)
  },
})
