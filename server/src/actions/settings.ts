// Actions to read and change settings: period, region, warnings, look and layout.

import { z } from 'zod'
import { checkBirthYear } from '../domain/retirement/assumptions.js'
import {
  getSettings,
  mergeSettings,
  saveSettings,
  settingsPatchSchema,
  type Settings,
} from '../domain/settings.js'
import { todayIn } from '../lib/dates.js'
import { defineAction } from './action.js'

/**
 * Settings as any caller sees them, without the owner's word on their pay:
 * get_pay reads that, so its payer salt and payer ids never leave the server.
 */
export const shownSettings = ({ pay: _pay, ...shown }: Settings) => shown

export const getSettingsAction = defineAction({
  name: 'get_settings',
  title: 'Get settings',
  description:
    "Read all preferences: budget period (monthly, weekly or per paycheck), time zone, currency, warning threshold, appearance, dashboard layout and the savings plan (emergency fund target in months, and which spending categories count as essential: null finds them from the bank codes or name of each category, counting housing, utilities, groceries, transport, health, insurance, child care and fixed loan payments, never credit card payments, with a loan or child care payment filed in another category, or an essential payment with no category, counted by its own bank code; a list counts exactly those categories, whole, never credit card payments; and goalsMonthlyCents, what goes to goals each month). The owner's pay is not here: read get_pay.",
  input: z.object({}),
  scope: 'read',
  surface: 'all',
  run: async (ctx) => shownSettings(await getSettings(ctx.db)),
})

export const updateSettingsAction = defineAction({
  name: 'update_settings',
  title: 'Update settings',
  description:
    'Change any preferences. Only the fields given change. appearance and savingsPlan merge field by field (savingsPlan: emergencyFundMonths 1 to 24, essentialCategoryIds where null finds the essential categories from their names and bank codes and counts a loan or child care payment filed elsewhere by its own bank code, and a list counts exactly those categories, whole, savingsRateTargetPercent where null sets no target, goalsMonthlyCents: what goes to goals each month, filling them in their order, where null uses the pace Leeway sees) and retirement merge field by field (retirement: birthYear from 110 years back to this year, retirementAge, returnPercent, inflationPercent, withdrawalPercent, monthlyContributionCents where null uses what Leeway found, targetMonthlyIncomeCents where null uses recent spending); period and dashboard.widgets replace the whole value.',
  input: settingsPatchSchema,
  scope: 'write',
  surface: 'all',
  run: async (ctx, patch) => {
    const settings = mergeSettings(await getSettings(ctx.db), patch)
    // Today where the owner lives, after any time zone change in the same patch.
    const today = todayIn(settings.timeZone, ctx.now())
    checkBirthYear(patch.retirement?.birthYear, today, 'retirement.birthYear')
    return shownSettings(await saveSettings(ctx.db, settings))
  },
})
