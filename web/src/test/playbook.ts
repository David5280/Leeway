// The payday playbook as get_payday_playbook returns it, the close-out and
// the plan worked out by the server's own math. Every name and amount is
// made up.

import { closeOut } from '../../../server/src/domain/playbook/closeOut'
import { planPaycheck, type StepNeed } from '../../../server/src/domain/playbook/plan'
import type { Playbook } from '../api/client'
import { forecastOf } from './overdraft'
import { noPay, PAY_TODAY, payView } from './pay'

type StepKey = StepNeed['key']

/** A flexible budget for the close-out: its name, budget and what was spent. */
export interface Budgeted {
  name: string
  budgetCents: number
  spentCents: number
}

/** The last pay period, Oct 30 to Nov 12, closed out from these budgets. */
export function closeOutOf(budgets: Budgeted[]): Playbook['closeOut'] {
  const categories = budgets.map((one, index) => ({
    id: `cat-${one.name.toLowerCase()}`,
    name: one.name,
    color: '#2a9d8f',
    icon: null,
    kind: 'expense' as const,
    budgetCents: one.budgetCents,
    budgetCadence: 'biweek' as const,
    warnAtPercent: null,
    trackPace: true,
    providerCategories: [],
    group: null,
    rollover: false,
    rolloverSince: null,
    position: index,
  }))
  const totals = budgets.map((one) => ({
    categoryId: `cat-${one.name.toLowerCase()}`,
    amountCents: one.spentCents,
    count: 1,
  }))
  return closeOut(categories, totals, { start: '2026-10-30', end: '2026-11-13' }, 'biweek')
}

/** A step asking for these items, each `[label, cents, date?, note?]`. */
export function stepNeed(
  key: StepKey,
  items: [string, number, (string | null)?, (string | null)?][],
): StepNeed {
  const planned = items.map(([label, amountCents, date = null, note = null]) => ({
    key: label.toLowerCase(),
    label,
    date,
    note,
    amountCents,
  }))
  return { key, needCents: planned.reduce((sum, one) => sum + one.amountCents, 0), items: planned }
}

/** Groceries under budget by $64, dining over by $20: $44 left over. */
export const UNDER_BUDGET: Budgeted[] = [
  { name: 'Groceries', budgetCents: 18_400, spentCents: 12_000 },
  { name: 'Dining', budgetCents: 9_000, spentCents: 11_000 },
]

/** The plan for the next $2,100 paycheck. */
export const NEEDS: StepNeed[] = [
  stepNeed('bills', [['Rent', 150_000, '2026-11-20']]),
  stepNeed('spending', [['Groceries', 18_400]]),
  stepNeed('savings', [['Savings', 21_000, null, '10% of pay']]),
]

/** The $2,100 paycheck planned: one that landed yesterday, or the next on Nov 27. */
const paycheckOf = (landed: boolean): Playbook['paycheck'] => ({
  amountCents: 210_000,
  date: landed ? '2026-11-16' : '2026-11-27',
  landed,
})

/** get_payday_playbook's answer: no pay known and no budgets, unless told otherwise. */
export function playbookOf(
  fields: { budgets?: Budgeted[]; needs?: StepNeed[]; justPaid?: boolean } = {},
): Playbook {
  const closed = closeOutOf(fields.budgets ?? [])
  const pay = fields.needs ? payView() : noPay
  const justPaid = fields.justPaid ?? false
  return {
    today: PAY_TODAY,
    pay,
    justPaid,
    paycheck: fields.needs ? paycheckOf(justPaid) : null,
    closeOut: closed,
    plan: fields.needs ? planPaycheck(210_000, closed.leftoverCents, fields.needs) : null,
    overdraft: forecastOf([]),
  }
}
