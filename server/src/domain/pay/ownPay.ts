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
// name, and settings are read back by an assistant. The id is keyed with a
// random salt kept for this install (salt.ts), so it cannot be matched to a
// name by hashing guesses.
//
// Each word names its job by that id, wherever the job ranks: a
// confirmation and the owner's own pay both follow their job when another
// pays more, and neither ever speaks for a different job.

import { createHmac } from 'node:crypto'
import { z } from 'zod'
import type { IsoDate } from '../../lib/dates.js'
import { PER_YEAR, type Cadence } from '../../lib/periods.js'
import { isoDateSchema } from '../../lib/schemas.js'
import { currentPay, type CurrentPay, type Employer } from './current.js'
import type { Deposit } from './deposits.js'
import type { GivenCadence } from './given.js'
import { nextOwnPayday } from './periodPayday.js'
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
  /**
   * True when it stands in for no job and counts beside every job paying:
   * saved when the job it was entered for had stopped (owner.ts).
   */
  besideJobs: z.boolean().default(false),
  /**
   * The day it was entered, which says whether its payday stands on a
   * weekend or holiday (periodPayday.ts); null for pay saved before.
   */
  givenOn: isoDateSchema.nullable().default(null),
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
  /** Keys payer ids (employerIdOf); saved before the first id is made (salt.ts), then kept for good. */
  payerSalt: z
    .string()
    .regex(/^[0-9a-f]{32}$/)
    .nullable()
    .default(null),
})

export type PaySettings = z.infer<typeof paySettingsSchema>

/** Nothing said yet: the paychecks as found. */
export const NO_PAY_SETTINGS: PaySettings = { confirmed: null, override: null, payerSalt: null }

/**
 * The salt payer ids are keyed with on this install. Every path that makes
 * an id saves one first (salt.ts), so an id never changes with a restart;
 * none saved yet means none was ever made, so there is none to match.
 */
export function payerSaltOf(pay: Pick<PaySettings, 'payerSalt'>): string {
  if (pay.payerSalt === null) throw new Error('Save the payer salt before making a payer id')
  return pay.payerSalt
}

/** An employer's id: the key its paychecks are grouped by (paychecks.ts), keyed with the salt. */
export const employerIdOf = (employer: Employer, pay: Pick<PaySettings, 'payerSalt'>) =>
  createHmac('sha256', payerSaltOf(pay))
    .update(payerKeyOf(employer.newest))
    .digest('hex')
    .slice(0, 16)

/** Whether the owner confirmed this employer paying on this cadence. */
export function isConfirmed(employer: Employer, pay: PaySettings): boolean {
  const { confirmed } = pay
  return (
    confirmed !== null &&
    confirmed.payerId === employerIdOf(employer, pay) &&
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
 * employer they confirmed, wherever it ranks now: paydays that fit two
 * cadences are then read their way, so paychecks a year and the next
 * payday are what they said is right, not the cautious reading. A saved
 * paystub (`paystub`) still speaks for the main job. As found when the
 * confirmation no longer matches.
 */
export function readAsConfirmed(
  deposits: Deposit[],
  found: CurrentPay,
  pay: PaySettings,
  today: IsoDate,
  paystub: GivenCadence | null = null,
): CurrentPay {
  const employer = found.employers.find((each) => isConfirmed(each, pay))
  if (!employer) return found
  // The owner's word first, so it wins over a paystub for the same job (current.ts).
  const confirmed = { cadence: pay.confirmed!.cadence, payerKey: payerKeyOf(employer.newest) }
  return currentPay(deposits, today, paystub ? [confirmed, paystub] : [confirmed])
}

/** The pay found, with the employer the owner confirmed no longer an estimate. */
function withConfirmation(pay: CurrentPay, given: PaySettings): CurrentPay {
  if (!pay.employers.some((employer) => isConfirmed(employer, given))) return pay
  const employers = pay.employers.map((employer) =>
    isConfirmed(employer, given) ? { ...employer, estimate: false } : employer,
  )
  return { ...pay, employer: employers[0]!, employers, estimate: employers.some((e) => e.estimate) }
}

/**
 * Which employer the owner's own pay stands in for: the one it was entered
 * for while that job still pays, or the main one when no job was found as
 * it was entered. -1 with no own pay, with no employer paying now, when it
 * was saved to stand beside every job, or when the job it was entered for
 * has stopped (jobStopped): it never takes the place of a different job
 * that is still paying.
 */
export function replacedIndex(employers: Employer[], pay: PaySettings): number {
  const { override } = pay
  if (!override || override.besideJobs) return -1
  if (override.payerId === null) return employers.length > 0 ? 0 : -1
  return employers.findIndex((employer) => employerIdOf(employer, pay) === override.payerId)
}

/** Whether the job the owner's own pay was entered for has stopped paying. */
export function jobStopped(employers: Employer[], pay: PaySettings): boolean {
  const payerId = pay.override?.payerId ?? null
  return payerId !== null && replacedIndex(employers, pay) === -1
}

/**
 * The pay found, with the owner's own pay standing in for the job it was
 * entered for: its paycheck, cadence and next payday, no longer an
 * estimate, and first, since payday is the owner's. Every other job found
 * still adds its month of pay, all of them when the job it was entered for
 * has stopped (the Payday screen says so) or it was saved to stand beside
 * every job.
 */
function withOverride(pay: CurrentPay, given: PaySettings, today: IsoDate): CurrentPay {
  const override = given.override!
  const { amountCents, cadence } = override
  const nextPayday = nextOwnPayday(override, today)
  const monthlyCents = ownMonthlyCents(override)
  const index = replacedIndex(pay.employers, given)
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
    // The owner's own amount, not the paystub's.
    fromPaystub: false,
  }
  // With no job in its place, the main pay is the owner's own, which no
  // employer stands for: `employer` is null and `employers` lists only the
  // jobs it counts beside (CurrentPay).
  const employers = own ? [own, ...others] : others
  return {
    ...pay,
    employer: own ?? null,
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
  if (given.override) return withOverride(pay, given, today)
  return withConfirmation(pay, given)
}
