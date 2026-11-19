// Settings, stored as one validated document with defaults for every field.

import { z } from 'zod'
import type { Db } from '../db/pool.js'
import { isValidTimeZone } from '../lib/dates.js'
import { isValidLocale } from '../lib/locale.js'
import { isoDateSchema } from '../lib/schemas.js'
import { aiSettingsSchema } from './ai/settings.js'
import type { PeriodConfig } from '../lib/periods.js'
import { retirementPatchSchema, retirementSchema } from './retirement/assumptions.js'
import { DEFAULT_EMERGENCY_MONTHS } from './savings/emergency.js'

const periodSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('monthly'),
    // Capped at 28 so every month has the start day.
    startDay: z.number().int().min(1).max(28).default(1),
  }),
  z.object({
    kind: z.literal('weekly'),
    weekStartsOn: z.number().int().min(0).max(6).default(1),
  }),
  z.object({
    kind: z.literal('paycheck'),
    frequency: z.enum(['weekly', 'biweekly', 'semimonthly', 'monthly']),
    anchorDate: isoDateSchema,
    semimonthlyDays: z
      .tuple([z.number().int().min(1).max(31), z.number().int().min(1).max(31)])
      .default([1, 15]),
  }),
])

export const THEMES = ['night', 'harbor', 'neon'] as const
export const ACCENTS = ['blue', 'teal', 'violet', 'orange', 'pink', 'mint'] as const
export const FONTS = ['geist', 'space-grotesk', 'ibm-plex', 'system'] as const
const WIDGETS = [
  'summary',
  'leeway',
  'glance',
  'alerts',
  'categories',
  'pace',
  'recent',
  'accounts',
  'merchants',
  'bills',
  'cash-flow',
  'net-worth',
  'goals',
  'debts',
  'trends',
] as const
const WIDGET_SIZES = ['half', 'wide', 'full'] as const

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex color like #4f8cff')

/** Each appearance option; 'theme' means "whatever the theme does". */
const appearanceFields = {
  theme: z.enum(THEMES),
  /** Light or dark. Every theme has both; 'theme' uses the one it is known for. */
  mode: z.enum(['theme', 'system', 'light', 'dark']),
  /** A named accent, a custom hex color, or the theme's own. */
  accent: z.union([z.literal('theme'), z.enum(ACCENTS), hexColor]),
  font: z.enum(['theme', ...FONTS]),
  density: z.enum(['comfortable', 'compact']),
  corners: z.enum(['theme', 'round', 'soft', 'square']),
}

const appearanceSchema = z.object({
  theme: appearanceFields.theme.default('night'),
  mode: appearanceFields.mode.default('theme'),
  accent: appearanceFields.accent.default('theme'),
  font: appearanceFields.font.default('theme'),
  density: appearanceFields.density.default('comfortable'),
  corners: appearanceFields.corners.default('theme'),
})

const widgetSchema = z.object({
  type: z.enum(WIDGETS),
  size: z.enum(WIDGET_SIZES).default('wide'),
  visible: z.boolean().default(true),
})

const DEFAULT_WIDGETS: z.infer<typeof widgetSchema>[] = [
  { type: 'summary', size: 'full', visible: true },
  { type: 'leeway', size: 'wide', visible: true },
  { type: 'glance', size: 'half', visible: true },
  { type: 'alerts', size: 'full', visible: true },
  { type: 'categories', size: 'wide', visible: true },
  { type: 'pace', size: 'half', visible: true },
  { type: 'recent', size: 'wide', visible: true },
  { type: 'accounts', size: 'half', visible: true },
]

const widgetsSchema = z
  .array(widgetSchema)
  .max(30)
  .refine(
    (widgets) => new Set(widgets.map((w) => w.type)).size === widgets.length,
    'Each widget can only appear once',
  )

/** Account ids picked on the Accounts dashboard; empty picks every account. */
const accountSelectionSchema = z.array(z.uuid()).max(100)

/**
 * How savings are judged: the emergency fund's target, what counts as
 * essential spending and the savings rate to aim for.
 */
const savingsPlanFields = {
  /** Months of essential spending the emergency fund should cover. */
  emergencyFundMonths: z
    .number()
    .int('Use a whole number of months')
    .min(1, 'Aim for at least one month')
    .max(24, 'Use 24 months or fewer'),
  /**
   * Spending categories that count as essential. Null counts every spending
   * category, and so does an empty list: no essentials at all would make any
   * savings balance look like endless cover.
   */
  essentialCategoryIds: z
    .array(z.uuid())
    .max(200)
    .nullable()
    .transform((ids) => (ids?.length ? ids : null)),
  /** Percent of pay to aim to save. Null sets no target. */
  savingsRateTargetPercent: z
    .number()
    .int('Use a whole percent')
    .min(1, 'Aim for at least 1%')
    .max(90, 'Use 90% or less')
    .nullable(),
}

const savingsPlanSchema = z.object({
  emergencyFundMonths: savingsPlanFields.emergencyFundMonths.default(DEFAULT_EMERGENCY_MONTHS),
  essentialCategoryIds: savingsPlanFields.essentialCategoryIds.default(null),
  // No target until the owner sets one: the rate counts only what the bank
  // shows, so a default would call a pension member short of a goal they
  // may well meet through payroll.
  savingsRateTargetPercent: savingsPlanFields.savingsRateTargetPercent.default(null),
})

/**
 * Every preference in one validated document. Defaults fill anything missing,
 * so an empty document is a complete, sensible setup.
 */
export const settingsSchema = z.object({
  period: periodSchema.default({ kind: 'monthly', startDay: 1 }),
  timeZone: z.string().refine(isValidTimeZone, 'Unknown time zone').default('UTC'),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .default('USD'),
  locale: z.string().refine(isValidLocale, 'Use a language tag like en-US').default('en-US'),
  /** Warn when a category passes this share of its budget, unless the category says otherwise. */
  defaultWarnAtPercent: z.number().int().min(1).max(100).default(80),
  /** How far ahead of steady spending (as a share of the budget) counts as "ahead of pace". */
  paceTolerancePercent: z.number().int().min(1).max(50).default(10),
  /** Count pending transactions toward budgets. */
  includePending: z.boolean().default(true),
  appearance: appearanceSchema.default(appearanceSchema.parse({})),
  dashboard: z.object({ widgets: widgetsSchema }).default({ widgets: DEFAULT_WIDGETS }),
  /**
   * The accounts picked on the Accounts dashboard, kept here rather than in
   * the browser so a laptop and a phone show the same pick. Empty means all.
   */
  accountSelection: accountSelectionSchema.default([]),
  /**
   * Whether Claude writes the dashboard summary (it also needs ANTHROPIC_API_KEY).
   * Only the owner can change it, in the app, because it sends data to Anthropic;
   * so it is left out of settingsPatchSchema, and of imports and agents with it.
   */
  aiSummary: z.boolean().default(false),
  /**
   * The model for each AI job and the monthly limit on AI spending (ai/settings.ts).
   * Owner-only for the same reason, and kept out of settingsPatchSchema with it.
   */
  ai: aiSettingsSchema.default(aiSettingsSchema.parse({})),
  savingsPlan: savingsPlanSchema.default(savingsPlanSchema.parse({})),
  /** Assumptions for retirement projections (retirement/assumptions.ts). */
  retirement: retirementSchema.default(retirementSchema.parse({})),
})

export type Settings = z.infer<typeof settingsSchema>

/**
 * What a caller may change: any subset. appearance, savingsPlan and retirement
 * merge; period and widgets replace.
 */
export const settingsPatchSchema = z
  .object({
    period: periodSchema,
    timeZone: settingsSchema.shape.timeZone.unwrap(),
    currency: settingsSchema.shape.currency.unwrap(),
    locale: settingsSchema.shape.locale.unwrap(),
    defaultWarnAtPercent: z.number().int().min(1).max(100),
    paceTolerancePercent: z.number().int().min(1).max(50),
    includePending: z.boolean(),
    // No defaults here: a partial patch must not reset the fields it leaves out.
    appearance: z.object(appearanceFields).partial(),
    dashboard: z.object({ widgets: widgetsSchema }),
    accountSelection: accountSelectionSchema,
    savingsPlan: z.object(savingsPlanFields).partial(),
    retirement: retirementPatchSchema,
  })
  .partial()
  .strict()

export type SettingsPatch = z.infer<typeof settingsPatchSchema>

export async function getSettings(db: Db): Promise<Settings> {
  const { rows } = await db.query<{ data: unknown }>('SELECT data FROM settings')
  // A stored document that no longer validates (say, a removed option) falls
  // back to defaults field by field instead of breaking the app.
  const parsed = settingsSchema.safeParse(rows[0]?.data ?? {})
  return parsed.success ? parsed.data : repair(rows[0]?.data)
}

function repair(data: unknown): Settings {
  const result = settingsSchema.parse({})
  if (!data || typeof data !== 'object') return result
  for (const [key, value] of Object.entries(data)) {
    const field = settingsSchema.shape[key as keyof Settings]
    const parsed = field?.safeParse(value)
    if (parsed?.success) Object.assign(result, { [key]: parsed.data })
  }
  // Keep the appearance options that are still valid, one by one.
  const appearance = (data as { appearance?: unknown }).appearance
  if (appearance && typeof appearance === 'object') {
    for (const [key, value] of Object.entries(appearance)) {
      const field = appearanceFields[key as keyof typeof appearanceFields]
      const parsed = field?.safeParse(value)
      if (parsed?.success) Object.assign(result.appearance, { [key]: parsed.data })
    }
  }
  return result
}

export function mergeSettings(current: Settings, patch: SettingsPatch): Settings {
  return settingsSchema.parse({
    ...current,
    ...patch,
    appearance: { ...current.appearance, ...patch.appearance },
    savingsPlan: { ...current.savingsPlan, ...patch.savingsPlan },
    retirement: { ...current.retirement, ...patch.retirement },
  })
}

/**
 * Takes deleted categories out of the essential ones the owner picked, so the
 * stored pick never points at a category that is gone. A pick left empty goes
 * back to counting every spending category.
 */
export async function forgetEssentialCategories(db: Db, deletedIds: string[]): Promise<void> {
  const settings = await getSettings(db)
  const picked = settings.savingsPlan.essentialCategoryIds
  if (!picked?.some((id) => deletedIds.includes(id))) return
  const kept = picked.filter((id) => !deletedIds.includes(id))
  await saveSettings(db, mergeSettings(settings, { savingsPlan: { essentialCategoryIds: kept } }))
}

export async function saveSettings(db: Db, settings: Settings): Promise<Settings> {
  await db.query('UPDATE settings SET data = $1, updated_at = now()', [JSON.stringify(settings)])
  return settings
}

export function periodConfig(settings: Settings): PeriodConfig {
  return settings.period as PeriodConfig
}
