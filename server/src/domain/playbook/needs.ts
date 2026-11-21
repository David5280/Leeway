// What each step of the paycheck's plan asks for, from what Leeway knows:
// the bills, sinking funds, overdrafts, budgets, goals, debts and savings
// target, each turned into one paycheck's worth. Pure; plan.ts shares the
// paycheck out among them.

import { convertCadence, type Cadence } from '../../lib/periods.js'
import type { Category } from '../categories.js'
import type { BillDue } from '../cashFlow.js'
import type { Goal } from '../goals.js'
import type { SinkingFund } from '../sinkingFunds/funds.js'
import { shareOf } from '../sinkingFunds/math.js'
import { isFlexible } from './closeOut.js'
import type { UpcomingEvent } from './events.js'
import { debtNeed, type PlanItem, type StepNeed } from './plan.js'

/** With no savings target set, the plan suggests saving this share of each paycheck. */
export const DEFAULT_SAVINGS_PERCENT = 10

/** The debt the plan puts extra toward: the costliest one owed. */
export interface DebtTarget {
  id: string
  name: string
  owedCents: number
  /** Its yearly interest rate, in hundredths of a percent; null when not known. */
  aprBps: number | null
}

export interface NeedFacts {
  /** How often pay comes: every need is one paycheck's worth. */
  payCadence: Cadence
  /** The budget period's cadence, which goals' plans are in. */
  periodCadence: Cadence
  payCents: number
  billsDue: BillDue[]
  funds: SinkingFund[]
  overdraftCents: number
  categories: Category[]
  /** Everyday spending a month when nothing is budgeted: typical spending less bills; null if unknown. */
  typicalSpendingMonthlyCents: number | null
  goals: Goal[]
  debt: DebtTarget | null
  savingsTargetPercent: number | null
  events: UpcomingEvent[]
}

const item = (key: string, label: string, amountCents: number, extra: Partial<PlanItem> = {}) => ({
  key,
  label,
  date: null,
  note: null,
  amountCents,
  ...extra,
})

const total = (items: PlanItem[]) => items.reduce((sum, one) => sum + one.amountCents, 0)

/** A step whose need is what its items add up to. */
const stepOf = (key: StepNeed['key'], items: PlanItem[]): StepNeed => ({
  key,
  needCents: total(items),
  items,
})

function billsNeed(facts: NeedFacts): StepNeed {
  return stepOf(
    'bills',
    facts.billsDue.map((bill) =>
      item(`${bill.billId}-${bill.dueDate}`, bill.name, bill.amountCents, { date: bill.dueDate }),
    ),
  )
}

function fundsNeed(facts: NeedFacts): StepNeed {
  return stepOf(
    'sinking_funds',
    facts.funds.map((fund) =>
      item(fund.id, fund.name, shareOf(fund, facts.payCadence), { date: fund.nextDueDate }),
    ),
  )
}

/**
 * Everyday spending until the next paycheck: the flexible budgets, a
 * paycheck's worth; with none, typical spending less bills stands in.
 */
function spendingNeed(facts: NeedFacts): StepNeed {
  const flexible = facts.categories.filter(isFlexible)
  if (flexible.length > 0) {
    return stepOf(
      'spending',
      flexible.map((category) =>
        item(
          category.id,
          category.name,
          convertCadence(category.budgetCents!, category.budgetCadence, facts.payCadence),
        ),
      ),
    )
  }
  const typical = facts.typicalSpendingMonthlyCents
  if (typical === null || typical <= 0) return stepOf('spending', [])
  const cents = convertCadence(typical, 'month', facts.payCadence)
  return stepOf('spending', [item('typical', 'Everyday spending', cents, { note: 'usual' })])
}

function goalsNeed(facts: NeedFacts): StepNeed {
  const planned = facts.goals.filter(
    (goal) =>
      (goal.status === 'in_progress' || goal.status === 'past_due') &&
      goal.perPeriodCents !== null &&
      goal.perPeriodCents > 0,
  )
  return stepOf(
    'goals',
    planned.map((goal) =>
      item(
        goal.id,
        goal.name,
        convertCadence(goal.perPeriodCents!, facts.periodCadence, facts.payCadence),
        { date: goal.targetDate },
      ),
    ),
  )
}

/** A rate in hundredths of a percent as words: 2499 is "24.99% interest". */
const aprWords = (bps: number) => `${(bps / 100).toFixed(2).replace(/\.?0+$/, '')}% interest`

function debtStep(debt: DebtTarget | null): StepNeed[] {
  if (!debt || debt.owedCents <= 0) return []
  const note = debt.aprBps === null ? null : aprWords(debt.aprBps)
  const need = debtNeed(debt.owedCents)
  return [
    {
      key: 'debt',
      needCents: need,
      // The amount is filled in once the plan knows what is free at debt's turn.
      items: [item(debt.id, debt.name, 0, { note })],
    },
  ]
}

function savingsNeed(facts: NeedFacts): StepNeed {
  const percent = facts.savingsTargetPercent ?? DEFAULT_SAVINGS_PERCENT
  const cents = Math.round((facts.payCents * percent) / 100)
  return stepOf('savings', [item('savings', 'Savings', cents, { note: `${percent}% of pay` })])
}

/** Every step's need, in priority order. */
export function stepNeeds(facts: NeedFacts): StepNeed[] {
  const overdraft = facts.overdraftCents
  return [
    billsNeed(facts),
    fundsNeed(facts),
    stepOf('overdraft', overdraft > 0 ? [item('overdraft', 'Back to zero', overdraft)] : []),
    spendingNeed(facts),
    goalsNeed(facts),
    ...debtStep(facts.debt),
    savingsNeed(facts),
    stepOf(
      'events',
      facts.events.map((event) =>
        item(event.key, event.name, event.costCents, { date: event.date }),
      ),
    ),
  ]
}
