import { z } from 'zod'
import type { Db } from '../db/pool.js'
import { isIsoDate, isValidTimeZone } from '../lib/dates.js'
import type { PeriodConfig } from '../lib/periods.js'

const isoDate = z.string().refine(isIsoDate, 'Use a real date as YYYY-MM-DD')

export const periodSchema = z.discriminatedUnion('kind', [
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
    anchorDate: isoDate,
    semimonthlyDays: z
      .tuple([z.number().int().min(1).max(31), z.number().int().min(1).max(31)])
      .default([1, 15]),
  }),
])

export const THEMES = ['night', 'harbor', 'neon'] as const
export const FONTS = ['inter', 'geist', 'ibm-plex', 'system'] as const
export const WIDGETS = [
  'left-to-spend',
  'categories',
  'pace',
  'recent',
  'bills',
  'cash-flow',
  'net-worth',
  'goals',
  'debts',
  'trends',
] as const

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex color like #4f8cff')

const appearanceFields = {
  theme: z.enum(THEMES),
  /** Overrides the theme's accent color. */
  accent: hexColor.nullable(),
  font: z.enum(FONTS),
  density: z.enum(['comfortable', 'compact']),
  /** Corner roundness, from square (0) to soft (16). */
  radius: z.number().int().min(0).max(16),
}

export const appearanceSchema = z.object({
  theme: appearanceFields.theme.default('night'),
  accent: appearanceFields.accent.default(null),
  font: appearanceFields.font.default('inter'),
  density: appearanceFields.density.default('comfortable'),
  radius: appearanceFields.radius.default(10),
})

export const widgetSchema = z.object({
  type: z.enum(WIDGETS),
  size: z.enum(['small', 'medium', 'large']).default('medium'),
})

const DEFAULT_WIDGETS: z.infer<typeof widgetSchema>[] = [
  { type: 'left-to-spend', size: 'large' },
  { type: 'categories', size: 'large' },
  { type: 'pace', size: 'medium' },
  { type: 'bills', size: 'medium' },
  { type: 'recent', size: 'medium' },
  { type: 'net-worth', size: 'small' },
]

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
  locale: z.string().default('en-US'),
  /** Warn when a category passes this share of its budget, unless the category says otherwise. */
  defaultWarnAtPercent: z.number().int().min(1).max(100).default(80),
  /** Count pending transactions toward budgets. */
  includePending: z.boolean().default(true),
  appearance: appearanceSchema.default(appearanceSchema.parse({})),
  dashboard: z.object({ widgets: z.array(widgetSchema).max(20) }).default({
    widgets: DEFAULT_WIDGETS,
  }),
})

export type Settings = z.infer<typeof settingsSchema>

/** What a caller may change: any subset; appearance merges, period and widgets replace. */
export const settingsPatchSchema = z
  .object({
    period: periodSchema,
    timeZone: settingsSchema.shape.timeZone.unwrap(),
    currency: settingsSchema.shape.currency.unwrap(),
    locale: z.string(),
    defaultWarnAtPercent: z.number().int().min(1).max(100),
    includePending: z.boolean(),
    // No defaults here: a partial patch must not reset the fields it leaves out.
    appearance: z.object(appearanceFields).partial(),
    dashboard: z.object({ widgets: z.array(widgetSchema).max(20) }),
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
  if (data && typeof data === 'object') {
    for (const [key, value] of Object.entries(data)) {
      const field = settingsSchema.shape[key as keyof Settings]
      const parsed = field?.safeParse(value)
      if (parsed?.success) Object.assign(result, { [key]: parsed.data })
    }
  }
  return result
}

export function mergeSettings(current: Settings, patch: SettingsPatch): Settings {
  return settingsSchema.parse({
    ...current,
    ...patch,
    appearance: { ...current.appearance, ...patch.appearance },
  })
}

export async function saveSettings(db: Db, settings: Settings): Promise<Settings> {
  await db.query('UPDATE settings SET data = $1, updated_at = now()', [JSON.stringify(settings)])
  return settings
}

export function periodConfig(settings: Settings): PeriodConfig {
  return settings.period as PeriodConfig
}
