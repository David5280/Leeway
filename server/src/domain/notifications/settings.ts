// The owner's notification choices: which alerts to hear about, their
// thresholds, and quiet hours. Stored in their own row, out of the settings
// document, so no assistant, export or import can change them.

import { z } from 'zod'
import type { Db } from '../../db/pool.js'

/** Every kind of notification, in the order Settings lists them. */
export const NOTIFICATION_KINDS = [
  'overdrawn',
  'over_limit',
  'overdraft_fee',
  'low_balance',
  'over_budget',
  'bill_due',
  'large_transaction',
  'bank_login',
  'ai_limit',
] as const

export type NotificationKind = (typeof NOTIFICATION_KINDS)[number]

/**
 * Kinds that are a condition, like being overdrawn or a bill unpaid: they
 * clear when the data no longer calls for them (a deposit, a payment, a
 * refund), and can come back.
 */
export const STATE_KINDS: readonly NotificationKind[] = [
  'overdrawn',
  'over_limit',
  'low_balance',
  'over_budget',
  'bill_due',
  'bank_login',
]

/** The kinds the owner has turned on. */
export function kindsOn(choices: Pick<NotificationSettings, 'kinds'>): NotificationKind[] {
  return NOTIFICATION_KINDS.filter((kind) => choices.kinds[kind])
}

const kindSwitches = Object.fromEntries(
  NOTIFICATION_KINDS.map((kind) => [kind, z.boolean()]),
) as Record<NotificationKind, z.ZodBoolean>

const hour = z.number().int().min(0).max(23)

/** Limits on each threshold, shared with the web app's inputs. */
export const LIMITS = {
  overBudgetPercent: { min: 50, max: 200 },
  billDueDays: { min: 0, max: 14 },
  largeTransactionCents: { min: 100, max: 100_000_000 },
} as const

const fields = {
  /** One switch per kind: on puts it in the inbox, and pushes it to devices with push on. */
  kinds: z.object(kindSwitches),
  /** A category's spending reaches this share of its budget. */
  overBudgetPercent: z
    .number()
    .int()
    .min(LIMITS.overBudgetPercent.min)
    .max(LIMITS.overBudgetPercent.max),
  /** A bill is this many days from its due date, or fewer. */
  billDueDays: z.number().int().min(LIMITS.billDueDays.min).max(LIMITS.billDueDays.max),
  /** A single charge of at least this much. */
  largeTransactionCents: z
    .number()
    .int()
    .min(LIMITS.largeTransactionCents.min)
    .max(LIMITS.largeTransactionCents.max),
  /** Hours, in the owner's time zone, when pushes wait. The inbox still fills. */
  quietHours: z.object({ on: z.boolean(), start: hour, end: hour }),
}

export const notificationSettingsSchema = z.object(fields)

export type NotificationSettings = z.output<typeof notificationSettingsSchema>

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  kinds: Object.fromEntries(NOTIFICATION_KINDS.map((kind) => [kind, true])) as Record<
    NotificationKind,
    boolean
  >,
  overBudgetPercent: 100,
  billDueDays: 2,
  largeTransactionCents: 50_000,
  quietHours: { on: true, start: 22, end: 7 },
}

/** What the owner may change: any subset; kinds and quiet hours merge. */
export const notificationSettingsPatchSchema = z
  .object({
    ...fields,
    kinds: fields.kinds.partial().strict(),
    quietHours: fields.quietHours.partial().strict(),
  })
  .partial()
  .strict()

export type NotificationSettingsPatch = z.output<typeof notificationSettingsPatchSchema>

/** The stored document over the defaults, field by field, so one bad field never loses the rest. */
function withDefaults(stored: unknown): NotificationSettings {
  const result = structuredClone(DEFAULT_NOTIFICATION_SETTINGS)
  if (!stored || typeof stored !== 'object') return result
  const data = stored as Record<string, unknown>
  for (const key of ['overBudgetPercent', 'billDueDays', 'largeTransactionCents'] as const) {
    const parsed = fields[key].safeParse(data[key])
    if (parsed.success) result[key] = parsed.data
  }
  const kinds = fields.kinds.partial().safeParse(data.kinds)
  if (kinds.success) Object.assign(result.kinds, kinds.data)
  const quiet = fields.quietHours.partial().safeParse(data.quietHours)
  if (quiet.success) Object.assign(result.quietHours, quiet.data)
  return result
}

export async function getNotificationSettings(db: Db): Promise<NotificationSettings> {
  const { rows } = await db.query<{ data: unknown }>('SELECT data FROM notification_settings')
  return withDefaults(rows[0]?.data)
}

export function mergeNotificationSettings(
  current: NotificationSettings,
  patch: NotificationSettingsPatch,
): NotificationSettings {
  return notificationSettingsSchema.parse({
    ...current,
    ...patch,
    kinds: { ...current.kinds, ...patch.kinds },
    quietHours: { ...current.quietHours, ...patch.quietHours },
  })
}

/** Saves the owner's changes. As with the other settings, the last write wins. */
export async function updateNotificationSettings(
  db: Db,
  patch: NotificationSettingsPatch,
): Promise<NotificationSettings> {
  const merged = mergeNotificationSettings(await getNotificationSettings(db), patch)
  await db.query('UPDATE notification_settings SET data = $1', [JSON.stringify(merged)])
  return merged
}
