// The owner's own word on their pay, kept in settings: a one-tap "that's
// right" on what Leeway found, or their own amount, cadence and next payday.
// Pure. source.ts lays it over the paychecks found (current.ts), so every
// figure built on pay (the payday, safe to spend, typical income, the
// playbook) goes by it. What Leeway found stays what the bank shows: a
// confirmation only settles the reading it confirmed, so it can be seen to
// go stale, and going back to the paychecks undoes the owner's pay.
//
// A payer is kept by an id made from its key, never the key itself: the key
// is the bank's text, which for a payroll paid in a person's name is that
// name, and settings are read back by an assistant.

import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { IsoDate } from '../../lib/dates.js'
import { PER_YEAR, type Cadence } from '../../lib/periods.js'
import { isoDateSchema } from '../../lib/schemas.js'
import { currentPay, type CurrentPay, type Employer } from './current.js'
import type { Deposit } from './deposits.js'
import { nextOwnPayday } from './ownSchedule.js'
import { payerKeyOf } from './paychecks.js'

/** How often a paycheck can come, as the owner says it. */
export const PAY_CADENCES = ['week', 'biweek', 'semimonth', 'month'] as const

/** The owner's own pay: what one paycheck brings, how often, and the next payday. */
export const payOverrideSchema = z.object({
  amountCents: z
    .number()
    .int()
    .positive('Enter what one paycheck brings in')
    .max(100_000_000, 'Enter one paycheck, not a year of pay'),
  cadence: z.enum(PAY_CADENCES),
  /** Any upcoming payday; later ones repeat from it by cadence. */
  nextPayday: isoDateSchema,
})

export type PayOverride = z.infer<typeof payOverrideSchema>

/** A payer's id (employerIdOf): sixteen hex digits. */
const payerIdSchema = z.string().regex(/^[0-9a-f]{16}$/)

/** The owner's own pay as saved, with the job it stands in for. */
const savedOverrideSchema = payOverrideSchema.extend({
  /** The employer it replaces, saved when it was entered; null when no job was found then. */
  payerId: payerIdSchema.nullable().default(null),
})

export type SavedOverride = z.infer<typeof savedOverrideSchema>

/** What the owner confirmed: the employer (by its id) and how often it pays. */
const confirmedSchema = z.object({
  payerId: payerIdSchema,
  cadence: z.enum(PAY_CADENCES),
})

export type ConfirmedPay = z.infer<typeof confirmedSchema>

export const paySettingsSchema = z.object({
  /** The detected pay the owner said is right; it stops being an estimate while it still matches. */
  confirmed: confirmedSchema.nullable().default(null),
  /** The owner's own pay, used instead of what was found. */
  override: savedOverrideSchema.nullable().default(null),
})

export type PaySettings = z.infer<typeof paySettingsSchema>

export const NO_PAY_SETTINGS: PaySettings = { confirmed: null, override: null }

/** An employer's id: a digest of the key its paychecks are grouped by (paychecks.ts). */
export const employerIdOf = (employer: Employer) =>
  createHash('sha256').update(payerKeyOf(employer.newest)).digest('hex').slice(0, 16)

/** Whether the owner confirmed this employer paying on this cadence. */
export function isConfirmed(employer: Employer, confirmed: ConfirmedPay | null): boolean {
  return (
    confirmed !== null &&
    confirmed.payerId === employerIdOf(employer) &&
    confirmed.cadence === employer.cadence
  )
}

/** A month of pay from one paycheck on a cadence. */
const monthlyOf = (cents: number, cadence: Cadence) => Math.round((cents * PER_YEAR[cadence]) / 12)

/** A month of the owner's own pay: their paycheck times paychecks a year, over twelve. */
export const ownMonthlyCents = (override: PayOverride) =>
  monthlyOf(override.amountCents, override.cadence)

/**
 * The pay found, read again with the cadence the owner confirmed for the
 * main employer: paydays that fit two cadences are then read their way, so
 * paychecks a year and the next payday are what they said is right, not
 * the cautious reading. As found when the confirmation no longer matches.
 */
export function readAsConfirmed(
  deposits: Deposit[],
  found: CurrentPay,
  confirmed: ConfirmedPay | null,
  today: IsoDate,
): CurrentPay {
  if (!found.employer || !isConfirmed(found.employer, confirmed)) return found
  const payerKey = payerKeyOf(found.employer.newest)
  return currentPay(deposits, today, { cadence: confirmed!.cadence, payerKey })
}

/** The pay found, with a confirmed main employer no longer an estimate. */
function withConfirmation(pay: CurrentPay, confirmed: ConfirmedPay | null): CurrentPay {
  if (!pay.employer || !isConfirmed(pay.employer, confirmed)) return pay
  const employers = pay.employers.map((employer, i) =>
    i === 0 ? { ...employer, estimate: false } : employer,
  )
  return { ...pay, employer: employers[0]!, employers, estimate: employers.some((e) => e.estimate) }
}

/**
 * Which employer the owner's own pay stands in for: the one it was entered
 * for while that job still pays, else the main one (also when none was
 * found as it was entered). -1 with no employer paying now.
 */
export function replacedIndex(employers: Employer[], override: SavedOverride): number {
  const index = employers.findIndex((employer) => employerIdOf(employer) === override.payerId)
  if (index >= 0) return index
  return employers.length > 0 ? 0 : -1
}

/**
 * The pay found, with the owner's own pay standing in for the job it was
 * entered for: its paycheck, cadence and next payday, no longer an
 * estimate, and first, since payday is the owner's. Any other job found
 * still adds its month of pay.
 */
function withOverride(pay: CurrentPay, override: SavedOverride, today: IsoDate): CurrentPay {
  const { amountCents, cadence } = override
  const nextPayday = nextOwnPayday(override, today)
  const monthlyCents = ownMonthlyCents(override)
  const index = replacedIndex(pay.employers, override)
  const replaced = pay.employers[index]
  const others = pay.employers.filter((_, i) => i !== index)
  // That job, now paid as the owner says, so its payday is theirs (payday.ts).
  const own = replaced && {
    ...replaced,
    cadence,
    paycheckCents: amountCents,
    monthlyCents,
    nextPayday,
    estimate: false,
  }
  const employers = own ? [own, ...others] : []
  return {
    ...pay,
    employer: employers[0] ?? null,
    employers,
    cadence,
    estimate: others.some((employer) => employer.estimate),
    paycheckCents: amountCents,
    monthlyCents: monthlyCents + others.reduce((sum, employer) => sum + employer.monthlyCents, 0),
    nextPayday,
    nextPaycheckCents: amountCents,
  }
}

/** The pay found, with the owner's word laid over it: their own pay first, else a confirmation. */
export function withOwnersPay(pay: CurrentPay, given: PaySettings, today: IsoDate): CurrentPay {
  if (given.override) return withOverride(pay, given.override, today)
  return withConfirmation(pay, given.confirmed)
}
