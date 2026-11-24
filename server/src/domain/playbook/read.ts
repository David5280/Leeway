// The payday playbook, read fresh: the pay period that just closed, what was
// left over and what to do with it, and the plan for the new paycheck. One
// read for the Payday screen and for an assistant explaining it.
// Suggestions only: nothing here moves money.

import type { Db } from '../../db/pool.js'
import { daysBetween, type IsoDate } from '../../lib/dates.js'
import { cadenceOf } from '../../lib/periods.js'
import { listBills } from '../bills.js'
import { setAsides } from '../budgetReport.js'
import { budgetSummaryWithRoom } from '../budgetRoom.js'
import type { CashFlow } from '../cashFlow.js'
import { listCategories } from '../categories.js'
import { categoryTotals } from '../categoryTotals.js'
import { paydayFrom } from '../pay/payday.js'
import { readCurrentPay } from '../pay/source.js'
import { periodConfig, type Settings } from '../settings.js'
import { closeOut, type CloseOut } from './closeOut.js'
import { readSuggestionFacts } from './facts.js'
import { planPaycheck, type PaycheckPlan } from './plan.js'
import { suggestLeftover, type Suggestion } from './suggestions.js'
import { closedPayPeriod, givenPayday, payScheduleOf, type ClosedPeriod } from './window.js'

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

/**
 * The new paycheck's plan: every bill due from the latest payday to the
 * next, and what can be spent now, the figure get_cash_flow's spendable
 * leads with (spendable.ts). Without a pay schedule the period starts today.
 */
async function readPlan(
  db: Db,
  settings: Settings,
  today: IsoDate,
  flow: CashFlow,
  spendableCents: number,
  period: ClosedPeriod | null,
): Promise<PaycheckPlan> {
  const held = await setAsides(db, settings, today)
  const bills = await listBills(db, today)
  return planPaycheck({
    paycheckCents: flow.expectedPayCents,
    periodStart: period?.end ?? today,
    nextPayday: flow.nextPayday,
    today,
    bills,
    setAsides: held,
    periodCadence: cadenceOf(periodConfig(settings)),
    payCadence: period?.cadence ?? null,
    safeToSpendCents: spendableCents,
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
  const pay = await readCurrentPay(db, settings, today)
  const { override } = settings.pay
  const schedule = payScheduleOf(
    periodConfig(settings),
    paydayFrom(pay, settings, today),
    pay,
    override,
  )
  const period = schedule ? closedPayPeriod(schedule, today, givenPayday(schedule, override)) : null
  const closed = period ? await readCloseOut(db, settings, period) : null
  // The suggestions' reads are only worth making when something was left.
  const suggestions =
    period && closed && closed.leftoverCents > 0
      ? suggestLeftover(
          closed.leftoverCents,
          await readSuggestionFacts(db, settings, today, now, period.cadence),
        )
      : []
  // The same read get_cash_flow makes, so the plan quotes the figure it leads with.
  const { budget, cashFlow: flow } = await budgetSummaryWithRoom(db, settings, now)
  // Always there for the current period; safe to spend alone only if it ever is not.
  const spendableCents = budget.spendable?.leadCents ?? flow.safeCents
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
    plan: await readPlan(db, settings, today, flow, spendableCents, period),
  }
}
