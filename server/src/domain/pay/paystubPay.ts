// A confirmed paystub's take-home pay laid over the paychecks found
// (current.ts), before the owner's own word (ownPay.ts), which still wins.
// Pure. The paystub sets what a paycheck from its job brings, and so that
// job's month of pay; the bank's deposits still set the paydays, so only a
// job the bank shows paying now takes it: a paystub never makes up a payday.
//
// It speaks for one job: the payer it names, or, when it names none the
// bank shows (as when only a payroll service shows), the main job if it was
// paid during that job's run, as a paystub's cadence does (given.ts). And
// only while it still fits that job:
// - the job pays on the paystub's cadence, since a paycheck's size depends on it
// - the job's paychecks have not moved since: the deposit on the paystub's
//   payday is within PAY_MOVED_SHARE of the usual paycheck now. A raise or
//   a new election after the paystub moves them, and the bank then knows
//   better. A paycheck split into an account Leeway does not see keeps the
//   same ratio, so the paystub's full take-home still counts.

import { addDays, daysBetween } from '../../lib/dates.js'
import { PER_YEAR } from '../../lib/periods.js'
import type { PaystubPay } from '../paystubs/applied.js'
import type { CurrentPay, Employer } from './current.js'
import { namesPayer, PAYSTUB_RUN_SLACK_DAYS } from './given.js'
import { payerKeyOf } from './paychecks.js'

/** How far the usual paycheck may sit from the one on the paystub's payday: 5%. */
export const PAY_MOVED_SHARE = 0.05

/** Which job paying now the paystub is from, by index, or -1 for none. */
function paystubJob(employers: Employer[], paystub: PaystubPay): number {
  const { employerName } = paystub
  if (employerName !== null) {
    const named = employers.findIndex((job) => namesPayer(employerName, payerKeyOf(job.newest)))
    if (named !== -1) return named
  }
  const main = employers[0]
  return main && paystub.payDate >= addDays(main.firstPaycheck, -PAYSTUB_RUN_SLACK_DAYS) ? 0 : -1
}

/** Whether the job's paychecks moved since the paystub: see the note at the top. */
function payMovedSince(pay: CurrentPay, job: Employer, paystub: PaystubPay): boolean {
  const key = payerKeyOf(job.newest)
  // The deposit can post a few days after the paystub's date.
  const onPayday = pay.paychecks.find(
    (paycheck) =>
      paycheck.payerKey === key &&
      Math.abs(daysBetween(paystub.payDate, paycheck.date)) <= PAYSTUB_RUN_SLACK_DAYS,
  )
  // No deposit that day to compare, as before the bank's history starts: nothing says it moved.
  if (!onPayday) return false
  return Math.abs(onPayday.amountCents - job.paycheckCents) > job.paycheckCents * PAY_MOVED_SHARE
}

/** The pay found, with the paystub's take-home standing for its job's paycheck while it fits. */
export function withPaystubPay(pay: CurrentPay, paystub: PaystubPay | null): CurrentPay {
  if (!paystub) return pay
  const index = paystubJob(pay.employers, paystub)
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
