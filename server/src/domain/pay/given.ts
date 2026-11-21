// The owner's own word on their pay, kept in settings: a one-tap "that's
// right" on what Leeway found, or their own amount, cadence and next payday.
// Pure. source.ts lays it over the paychecks found (current.ts), so every
// figure built on pay (the payday, safe to spend, typical income, the
// playbook) goes by it.

import { z } from 'zod'
import { addCadence, PER_YEAR, type Cadence } from '../../lib/periods.js'
import type { IsoDate } from '../../lib/dates.js'
import { isoDateSchema } from '../../lib/schemas.js'
import { merchantKey } from '../merchantKey.js'
import type { CurrentPay, Employer } from './current.js'

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

/** What the owner confirmed: the employer (by its merchant key) and how often it pays. */
const confirmedSchema = z.object({
  payerKey: z.string().min(1).max(200),
  cadence: z.enum(PAY_CADENCES),
})

export type ConfirmedPay = z.infer<typeof confirmedSchema>

export const paySettingsSchema = z.object({
  /** The detected pay the owner said is right; it stops being an estimate while it still matches. */
  confirmed: confirmedSchema.nullable().default(null),
  /** The owner's own pay, used instead of what was found. */
  override: payOverrideSchema.nullable().default(null),
})

export type PaySettings = z.infer<typeof paySettingsSchema>

export const NO_PAY_SETTINGS: PaySettings = { confirmed: null, override: null }

/** The merchant key an employer's deposits are grouped by, as a confirmation stores it. */
export const payerKeyOf = (employer: Employer) => merchantKey(employer.newest)

/** Whether the owner confirmed this employer paying on this cadence. */
export function isConfirmed(employer: Employer, confirmed: ConfirmedPay | null): boolean {
  return (
    confirmed !== null &&
    confirmed.payerKey === payerKeyOf(employer) &&
    confirmed.cadence === employer.cadence
  )
}

/** The first payday on the owner's schedule after today, stepping forward from the one they gave. */
export function nextGivenPayday(override: PayOverride, today: IsoDate): IsoDate {
  let next = override.nextPayday
  // A payday given long ago is stepped forward a cycle at a time; never more than a few hundred.
  while (next <= today) next = addCadence(next, override.cadence as Cadence)
  return next
}

/** A month of pay from one paycheck on a cadence. */
const monthlyOf = (cents: number, cadence: Cadence) => Math.round((cents * PER_YEAR[cadence]) / 12)

/** The pay found, with a confirmed main employer no longer an estimate. */
function withConfirmation(pay: CurrentPay, confirmed: ConfirmedPay | null): CurrentPay {
  if (!pay.employer || !isConfirmed(pay.employer, confirmed)) return pay
  const employers = pay.employers.map((employer, i) =>
    i === 0 ? { ...employer, estimate: false } : employer,
  )
  return { ...pay, employer: employers[0]!, employers, estimate: employers.some((e) => e.estimate) }
}

/**
 * The pay found, with the owner's own pay standing in for the main
 * employer's: its paycheck, cadence and next payday. Payday is the owner's,
 * as the main job's is; any second job found still adds its month of pay.
 */
function withOverride(pay: CurrentPay, override: PayOverride, today: IsoDate): CurrentPay {
  const others = pay.employers.slice(1)
  return {
    ...pay,
    cadence: override.cadence,
    estimate: others.some((employer) => employer.estimate),
    paycheckCents: override.amountCents,
    monthlyCents:
      monthlyOf(override.amountCents, override.cadence) +
      others.reduce((sum, employer) => sum + employer.monthlyCents, 0),
    nextPayday: nextGivenPayday(override, today),
    nextPaycheckCents: override.amountCents,
  }
}

/** The pay found, with the owner's word laid over it: their own pay first, else a confirmation. */
export function withOwnersPay(pay: CurrentPay, given: PaySettings, today: IsoDate): CurrentPay {
  if (given.override) return withOverride(pay, given.override, today)
  return withConfirmation(pay, given.confirmed)
}
