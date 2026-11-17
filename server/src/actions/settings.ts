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
    'Read all preferences: budget period (monthly, weekly or per paycheck), time zone, currency, warning threshold, appearance and dashboard layout.',
  input: z.object({}),
  scope: 'read',
  surface: 'all',
  run: (ctx) => getSettings(ctx.db),
})

export const updateSettingsAction = defineAction({
  name: 'update_settings',
  title: 'Update settings',
  description:
    'Change any preferences. Only the fields given change. appearance merges field by field; period and dashboard.widgets replace the whole value.',
  input: settingsPatchSchema,
  scope: 'write',
  surface: 'all',
  run: async (ctx, patch) => saveSettings(ctx.db, mergeSettings(await getSettings(ctx.db), patch)),
})
