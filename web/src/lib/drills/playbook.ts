// The payday playbook's drill-downs: the last paycheck's leftover, budget
// by budget, and the new paycheck's plan, every dollar to its step. Pure,
// like every drill in lib/drills.

import type { PaycheckPlan, Playbook } from '../../api/client'
import { leftoverTone, STEP_WORDS } from '../../pages/plan/payday/playbookText'
import type { DrillDown, DrillItem, MathTerm } from '../drill'

type CloseOut = Playbook['closeOut']
type Dates = (iso: string) => string
type Money = (cents: number) => string

/** What was left of the everyday budgets, and each budget's share of it. */
export function closeOutDrill(closeOut: CloseOut, period: string, money: Money): DrillDown {
  const over = closeOut.leftoverCents < 0
  return {
    title: over ? 'Over budget' : 'Left over',
    subtitle: period,
    figure: { cents: Math.abs(closeOut.leftoverCents), tone: leftoverTone(closeOut.leftoverCents) },
    math: {
      terms: [
        { label: 'Budgeted', value: { cents: closeOut.budgetedCents } },
        { label: 'spent', value: { cents: closeOut.spentCents }, op: 'minus' },
      ],
      result: {
        label: over ? 'Over budget by' : 'Left over',
        value: { cents: Math.abs(closeOut.leftoverCents) },
      },
      note: 'Everyday spending is the budgets that follow a pace, like groceries and dining. Bills are paid whatever happens, so they are planned on their own.',
    },
    items: {
      title: 'Budget by budget',
      rows: closeOut.categories.map((row) => ({
        key: row.categoryId,
        label: row.name,
        detail: `Spent ${money(row.spentCents)} of ${money(row.budgetCents)}`,
        value: { cents: row.leftCents, tone: row.leftCents < 0 ? 'warn' : 'neutral' },
        icon: {
          category: { name: row.name, color: row.color, icon: row.icon, kind: 'expense' },
        },
        to: `/budgets/${row.categoryId}`,
      })),
    },
  }
}

/** The paycheck plus what was left (or less what ran over) is what the plan shares out. */
function planTerms(plan: PaycheckPlan): MathTerm[] {
  const terms: MathTerm[] = [{ label: 'Paycheck', value: { cents: plan.payCents } }]
  if (plan.leftoverCents > 0) {
    terms.push({ label: 'left over', value: { cents: plan.leftoverCents }, op: 'plus' })
  }
  if (plan.leftoverCents < 0) {
    terms.push({ label: 'over budget', value: { cents: -plan.leftoverCents }, op: 'minus' })
  }
  return terms
}

/** Every item of every step, in the plan's order, with its step's name. */
function planRows(plan: PaycheckPlan, date: Dates): DrillItem[] {
  return plan.steps.flatMap((step) =>
    step.items.map((item) => ({
      key: `${step.key}-${item.key}`,
      label: item.label === 'Extra' ? 'Anything still free' : item.label,
      detail: [STEP_WORDS[step.key], item.date && date(item.date), item.note]
        .filter(Boolean)
        .join(', '),
      value: { cents: item.amountCents },
    })),
  )
}

/** The plan: what there is to share out, and where each dollar goes. */
export function planDrill(plan: PaycheckPlan, date: Dates): DrillDown {
  return {
    title: 'Paycheck plan',
    subtitle: 'Suggestions only. You move the money.',
    figure: { cents: plan.toPlanCents },
    math: {
      terms: planTerms(plan),
      result: { label: 'To plan', value: { cents: plan.toPlanCents } },
      note: 'Shared out most pressing first: bills due before payday, yearly costs, getting back above zero, everyday spending, goals, extra on the costliest debt, then savings. Anything still free goes to savings.',
    },
    items: { title: 'Where it goes', rows: planRows(plan, date) },
  }
}
