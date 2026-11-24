// A confirmed paystub's take-home pay laid over the paychecks found
// (current.ts), before the owner's own word (ownPay.ts), which still wins.
// Pure. The paystub sets what a paycheck from its job brings, and so that
// job's month of pay; the bank's deposits still set the paydays, so only a
// job the bank shows paying now takes it: a paystub never makes up a payday.
//
// It speaks for one job, and only one the bank backs. The deposit nearest
// the paystub's payday (within a few days, as it can post late) must be
// within PAY_MOVED_SHARE of the paystub's take-home: the job it names when
// the bank shows that name, otherwise whichever job's deposit matches (as
// when only a payroll service's name shows). So a side job's paystub never
// lands on the main job, and a paycheck split into an account Leeway does
// not see (the bank shows less than the paystub's take-home) leaves pay as
// the bank shows it, since that is what reaches the accounts Leeway reads.
// With no deposit near the payday to compare, as before the bank's history
// starts, it falls back to the main job only when there is exactly one job,
// and only if the paystub was paid during that job's run (given.ts).
// Otherwise pay is left alone; the profile's paystub figures (gross, taxes,
// retirement) still apply, as they never depend on which job it is.
//
// And only while it still fits that job:
// - the job pays on the paystub's cadence, since a paycheck's size depends on it
// - the job's paychecks have not moved since: the usual paycheck now is
//   within PAY_MOVED_SHARE of the deposit on the paystub's payday. A raise or
//   a new election after the paystub moves them, and the bank then knows better.

import { addDays, daysBetween } from '../../lib/dates.js'
import { PER_YEAR } from '../../lib/periods.js'
import type { PaystubPay } from '../paystubs/applied.js'
import type { CurrentPay, Employer } from './current.js'
import { namesPayer, PAYSTUB_RUN_SLACK_DAYS } from './given.js'
import { payerKeyOf, type Paycheck } from './paychecks.js'

/** How far two paychecks may sit apart and still be the same pay: 5%. */
export const PAY_MOVED_SHARE = 0.05

/** Whether `cents` is within PAY_MOVED_SHARE of `of`. */
const closeTo = (cents: number, of: number) => Math.abs(cents - of) <= of * PAY_MOVED_SHARE

/** The job's deposit nearest the paystub's payday, within a few days of it, or null. */
function depositNear(pay: CurrentPay, job: Employer, paystub: PaystubPay): Paycheck | null {
  const key = payerKeyOf(job.newest)
  let nearest: Paycheck | null = null
  let nearestDays = PAYSTUB_RUN_SLACK_DAYS + 1
  for (const paycheck of pay.paychecks) {
    if (paycheck.payerKey !== key) continue
    const days = Math.abs(daysBetween(paystub.payDate, paycheck.date))
    if (days < nearestDays) [nearest, nearestDays] = [paycheck, days]
  }
  return nearest
}

/** Which job paying now the paystub is from, by index, or -1 for none: see the note at the top. */
function paystubJob(pay: CurrentPay, paystub: PaystubPay): number {
  const { employers } = pay
  const { employerName } = paystub
  const named =
    employerName === null
      ? -1
      : employers.findIndex((job) => namesPayer(employerName, payerKeyOf(job.newest)))
  // A job it names is the only one it can be; otherwise any job the bank shows.
  const candidates = named !== -1 ? [named] : employers.map((_, i) => i)
  const matched = candidates.find((i) => {
    const deposit = depositNear(pay, employers[i]!, paystub)
    return deposit !== null && closeTo(deposit.amountCents, paystub.netCents)
  })
  if (matched !== undefined) return matched

  // No deposit backs it. Only a lone job with no deposit near the payday to compare takes it.
  const only = employers.length === 1 ? employers[0]! : null
  if (!only || depositNear(pay, only, paystub)) return -1
  return paystub.payDate >= addDays(only.firstPaycheck, -PAYSTUB_RUN_SLACK_DAYS) ? 0 : -1
}

/** Whether the job's paychecks moved since the paystub: see the note at the top. */
function payMovedSince(pay: CurrentPay, job: Employer, paystub: PaystubPay): boolean {
  const onPayday = depositNear(pay, job, paystub)
  // No deposit that day to compare, as before the bank's history starts: nothing says it moved.
  return onPayday !== null && !closeTo(onPayday.amountCents, job.paycheckCents)
}

/** The pay found, with the paystub's take-home standing for its job's paycheck while it fits. */
export function withPaystubPay(pay: CurrentPay, paystub: PaystubPay | null): CurrentPay {
  if (!paystub) return pay
  const index = paystubJob(pay, paystub)
  const job = pay.employers[index]
  if (!job || job.cadence !== paystub.cadence || payMovedSince(pay, job, paystub)) return pay
  const monthlyCents = Math.round((paystub.netCents * PER_YEAR[paystub.cadence]) / 12)
  const paid: Employer = {
    ...job,
    paycheckCents: paystub.netCents,
    monthlyCents,
    fromPaystub: true,
  }
  // Kept in its place, so the main job, and the payday it sets, stay the same.
  const employers = pay.employers.map((employer, i) => (i === index ? paid : employer))
  const main = index === 0
  return {
    ...pay,
    employer: main ? paid : pay.employer,
    employers,
    paycheckCents: main ? paid.paycheckCents : pay.paycheckCents,
    nextPaycheckCents: main ? paid.paycheckCents : pay.nextPaycheckCents,
    monthlyCents: employers.reduce((sum, employer) => sum + employer.monthlyCents, 0),
  }
}
