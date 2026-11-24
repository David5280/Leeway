// The payday playbook, read fresh: the pay period that just closed, what was
// left over and what to do with it, and the plan for the new paycheck. One
// read for the Payday screen and for an assistant explaining it.
// Suggestions only: nothing here moves money.

import type { Db } from '../../db/pool.js'
import { daysBetween, type IsoDate } from '../../lib/dates.js'
import { cadenceOf } from '../../lib/periods.js'
import { readBelowZero } from '../belowZeroSource.js'
import { setAsides } from '../budgetReport.js'
import { getCashFlow, type CashFlow } from '../cashFlow.js'
import { listCategories } from '../categories.js'
import { categoryTotals } from '../categoryTotals.js'
import { paydayFrom } from '../pay/payday.js'
import { readCurrentPay } from '../pay/source.js'
import { periodConfig, type Settings } from '../settings.js'
import { closeOut, type CloseOut } from './closeOut.js'
import { readSuggestionFacts } from './facts.js'
import { planPaycheck, type PaycheckPlan } from './plan.js'
import { suggestLeftover, type Suggestion } from './suggestions.js'
import { closedPayPeriod, payScheduleOf, type ClosedPeriod } from './window.js'

/** Days after a payday that the playbook greets its paycheck as new. */
export const JUST_PAID_DAYS = 3

export interface Playbook {
  today: IsoDate
  /** The latest payday, on or before today; null while no pay schedule is known. */
  lastPayday: IsoDate | null
  /** A payday in the last JUST_PAID_DAYS days: a new paycheck has just landed. */
  justPaid: boolean
  nextPayday: IsoDate
  paydaySource: CashFlow['paydaySource']
  paydayEstimate: boolean
  /** The pay period that just closed; null while no pay schedule is known. */
  closeOut: CloseOut | null
  /** What to do with the leftover, in order; empty when nothing was left. */
  suggestions: Suggestion[]
  plan: PaycheckPlan
}

/** The close-out of the period that just closed, from what was spent in it. */
async function readCloseOut(db: Db, settings: Settings, period: ClosedPeriod): Promise<CloseOut> {
  const categories = await listCategories(db)
  const totals = await categoryTotals(db, period.start, period.end, settings.includePending)
  return closeOut(categories, totals, period)
}

/** The new paycheck's plan, from the cash flow already read. */
async function readPlan(
  db: Db,
  settings: Settings,
  today: IsoDate,
  flow: CashFlow,
  payCadence: ClosedPeriod['cadence'] | null,
): Promise<PaycheckPlan> {
  const held = await setAsides(db, settings, today)
  const belowZero = await readBelowZero(db, flow)
  return planPaycheck({
    paycheckCents: flow.expectedPayCents,
    nextPayday: flow.nextPayday,
    billsDue: flow.billsDue,
    setAsides: held,
    periodCadence: cadenceOf(periodConfig(settings)),
    payCadence,
    safeToSpendCents: flow.safeCents,
    belowZero,
  })
}

/** The playbook as of today. */
export async function readPlaybook(
  db: Db,
  settings: Settings,
  today: IsoDate,
  now: Date,
): Promise<Playbook> {
  // One at a time: db may be a transaction's client, which runs one query at once.
  const payday = paydayFrom(await readCurrentPay(db, settings, today), settings, today)
  const schedule = payScheduleOf(periodConfig(settings), payday)
  const period = schedule ? closedPayPeriod(schedule, today) : null
  const closed = period ? await readCloseOut(db, settings, period) : null
  // The suggestions' reads are only worth making when something was left.
  const suggestions =
    period && closed && closed.leftoverCents > 0
      ? suggestLeftover(
          closed.leftoverCents,
          await readSuggestionFacts(db, settings, today, now, period.cadence),
        )
      : []
  const flow = await getCashFlow(db, settings, today)
  const lastPayday = period?.end ?? null
  return {
    today,
    lastPayday,
    justPaid: lastPayday !== null && daysBetween(lastPayday, today) < JUST_PAID_DAYS,
    nextPayday: flow.nextPayday,
    paydaySource: flow.paydaySource,
    paydayEstimate: flow.paydayEstimate,
    closeOut: closed,
    suggestions,
    plan: await readPlan(db, settings, today, flow, period?.cadence ?? null),
  }
}
