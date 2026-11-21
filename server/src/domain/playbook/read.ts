// The payday playbook, read fresh: the last pay period closed out, the new
// paycheck's plan, each checking account's forecast to payday, and the
// sinking funds. One read for the Payday screen and for an assistant
// explaining it. Suggestions only: nothing here moves money.

import type { Db } from '../../db/pool.js'
import type { IsoDate } from '../../lib/dates.js'
import { addDays } from '../../lib/dates.js'
import { cadenceOf, type Cadence } from '../../lib/periods.js'
import { isCounted } from '../accountSharing.js'
import { listAccounts, type Account } from '../accounts.js'
import { categoryTotals } from '../budgetReport.js'
import { listBills } from '../bills.js'
import { getCashFlow } from '../cashFlow.js'
import { listCategories } from '../categories.js'
import { listGoals } from '../goals.js'
import { readOverdraftForecast, type OverdraftForecast } from '../overdraft/source.js'
import { readPayView, type PayView } from '../pay/view.js'
import { typicalMonth } from '../profile/income.js'
import { periodConfig, type Settings } from '../settings.js'
import { listFunds } from '../sinkingFunds/funds.js'
import { closeOut, isFlexible, type CloseOut } from './closeOut.js'
import { noEvents, type EventSource } from './events.js'
import { stepNeeds, type DebtTarget } from './needs.js'
import { planPaycheck, type PaycheckPlan } from './plan.js'
import { justPaid, lastPayPeriod } from './window.js'

/** The paycheck the plan is for: one that just landed, else the next one expected. */
export interface PlannedPaycheck {
  amountCents: number
  date: IsoDate
  landed: boolean
}

export interface Playbook {
  today: IsoDate
  pay: PayView
  /** A paycheck landed in the last few days: the playbook greets it. */
  justPaid: boolean
  /** Null while no pay is known: the owner is asked for it instead. */
  paycheck: PlannedPaycheck | null
  closeOut: CloseOut
  /** Null while no pay is known. */
  plan: PaycheckPlan | null
  overdraft: OverdraftForecast
}

/** The paycheck to plan: the one that just landed, else the next one expected. */
function plannedPaycheck(pay: PayView, paid: boolean): PlannedPaycheck | null {
  if (paid && pay.lastPaycheck) return { ...pay.lastPaycheck, landed: true }
  if (!pay.pay) return null
  return { amountCents: pay.pay.nextPaycheckCents, date: pay.pay.nextPayday, landed: false }
}

/** The costliest debt owed: the highest known rate, else the biggest balance owed. */
export function debtTarget(accounts: Account[]): DebtTarget | null {
  const owed = accounts.flatMap((account) => {
    const owedCents = account.balanceCents ?? 0
    const isDebt = account.type === 'credit' || account.type === 'loan'
    return isCounted(account) && isDebt && owedCents > 0 ? [{ account, owedCents }] : []
  })
  const rate = ({ account }: { account: Account }) => account.aprPercent ?? -1
  const [top] = owed.sort((a, b) => rate(b) - rate(a) || b.owedCents - a.owedCents)
  if (!top) return null
  const { account, owedCents } = top
  return {
    id: account.id,
    name: account.name,
    owedCents,
    aprBps: account.aprPercent === null ? null : Math.round(account.aprPercent * 100),
  }
}

/** Everyday spending a month with nothing budgeted: typical spending less the bills. */
async function typicalEverydayMonthly(
  db: Db,
  settings: Settings,
  today: IsoDate,
): Promise<number | null> {
  const { monthly } = await typicalMonth(db, settings, today)
  if (monthly.spendingCents === null) return null
  const bills = await listBills(db, today)
  return monthly.spendingCents - bills.reduce((sum, bill) => sum + bill.monthlyCents, 0)
}

/** The plan for the paycheck, from everything each step needs. */
async function readPlan(
  db: Db,
  settings: Settings,
  today: IsoDate,
  facts: {
    paycheck: PlannedPaycheck
    payCadence: Cadence
    leftoverCents: number
    events: EventSource
  },
): Promise<PaycheckPlan> {
  // One at a time: db may be a transaction's client, which runs one query at once.
  const config = periodConfig(settings)
  const cashFlow = await getCashFlow(db, settings, today)
  const categories = await listCategories(db)
  const funds = await listFunds(db, today, cadenceOf(config))
  const goals = await listGoals(db, { today, period: config })
  const accounts = await listAccounts(db, false)
  const typical = categories.some(isFlexible)
    ? null
    : await typicalEverydayMonthly(db, settings, today)
  // Events before the payday after next: what this paycheck has to get ready for.
  const horizon = addDays(cashFlow.nextPayday, 31)
  const events = await facts.events(db, today, horizon)
  const needs = stepNeeds({
    payCadence: facts.payCadence,
    periodCadence: cadenceOf(config),
    payCents: facts.paycheck.amountCents,
    billsDue: cashFlow.billsDue,
    funds,
    overdraftCents: cashFlow.overdraftCents,
    categories,
    typicalSpendingMonthlyCents: typical,
    goals,
    debt: debtTarget(accounts),
    savingsTargetPercent: settings.savingsPlan.savingsRateTargetPercent,
    events,
  })
  return planPaycheck(facts.paycheck.amountCents, facts.leftoverCents, needs)
}

/** The playbook as of today. `events` is the calendar seam (events.ts). */
export async function readPlaybook(
  db: Db,
  settings: Settings,
  today: IsoDate,
  events: EventSource = noEvents,
): Promise<Playbook> {
  const config = periodConfig(settings)
  const pay = await readPayView(db, settings, today)
  const paid = justPaid(pay.lastPaycheck?.date ?? null, today)
  const payCadence = pay.pay?.cadence ?? null
  const last = lastPayPeriod(
    { cadence: payCadence, paydays: pay.paydays, nextPayday: pay.pay?.nextPayday ?? null },
    today,
    config,
  )
  const totals = await categoryTotals(
    db,
    last.window.start,
    last.window.end,
    settings.includePending,
  )
  const closed = closeOut(await listCategories(db), totals, last.window, last.per)
  const paycheck = plannedPaycheck(pay, paid)
  const plan =
    paycheck && payCadence
      ? await readPlan(db, settings, today, {
          paycheck,
          payCadence,
          leftoverCents: closed.leftoverCents,
          events,
        })
      : null
  const overdraft = await readOverdraftForecast(db, settings, today)
  return { today, pay, justPaid: paid, paycheck, closeOut: closed, plan, overdraft }
}
