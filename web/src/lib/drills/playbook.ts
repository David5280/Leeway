// The payday playbook's drill-downs: the last paycheck's leftover, budget
// by budget; the leftover shared out over the ideas for it; and the new
// paycheck's plan, line by line. Pure, like every drill in lib/drills.

import type { CloseOut, LeftoverSuggestion, PaycheckPlan, PlanLine } from '../../api/client'
import {
  ideaReason,
  leftoverLabel,
  leftoverTone,
  LINE_WORDS,
  SUGGESTIONS_ONLY,
} from '../../pages/plan/payday/playbookText'
import type { DrillDown, DrillItem, MathTerm } from '../drill'

type Dates = (iso: string) => string
type Money = (cents: number) => string

/** What was left of the everyday budgets, and each budget's share of it. */
export function closeOutDrill(closeOut: CloseOut, period: string, money: Money): DrillDown {
  const label = leftoverLabel(closeOut)
  const cents = Math.abs(closeOut.leftoverCents)
  return {
    title: 'Last paycheck',
    subtitle: period,
    figure: { cents, tone: leftoverTone(closeOut.leftoverCents) },
    math: {
      terms: [
        { label: 'Budgeted', value: { cents: closeOut.budgetedCents } },
        { label: 'spent', value: { cents: closeOut.spentCents }, op: 'minus' },
      ],
      result: { label, value: { cents } },
      note: 'Everyday spending is the budgets that follow a pace, like groceries and dining. Bills are paid whatever happens, so they belong to the new paycheck. Moving money between your own accounts never counts.',
    },
    items: {
      title: 'Budget by budget',
      rows: closeOut.categories.map((row) => ({
        key: row.categoryId,
        label: row.name,
        detail: `Spent ${money(row.spentCents)} of ${money(row.budgetCents)}`,
        value: { cents: row.leftCents, tone: row.leftCents < 0 ? 'warn' : 'neutral' },
        to: `/budgets/${row.categoryId}`,
      })),
    },
  }
}

/** The leftover, less each idea's share, in the order they are offered. */
export function suggestionsDrill(
  suggestions: LeftoverSuggestion[],
  leftoverCents: number,
  date: Dates,
): DrillDown {
  const given = suggestions.reduce((sum, one) => sum + one.amountCents, 0)
  const terms: MathTerm[] = [
    { label: 'Left over', value: { cents: leftoverCents, tone: 'in' } },
    ...suggestions.map((one): MathTerm => ({
      label: one.label,
      value: { cents: one.amountCents },
      op: 'minus',
    })),
  ]
  return {
    title: 'Ideas for what was left',
    subtitle: SUGGESTIONS_ONLY,
    figure: { cents: leftoverCents, tone: 'in' },
    math: {
      terms,
      result: { label: 'Still free', value: { cents: Math.max(0, leftoverCents - given) } },
      note: 'Offered in order: the emergency fund, the goals due soonest, the highest interest debt, retirement, then extra cash sitting in checking.',
    },
    items: {
      title: 'Why each one',
      rows: suggestions.map((one, index) => ({
        key: `${one.kind}-${index}`,
        label: one.label,
        detail: ideaReason(one, date),
        value: { cents: one.amountCents },
      })),
    },
  }
}

/** The paycheck less what is spoken for; while pay is unknown, the same math with the gaps named. */
function planMath(plan: PaycheckPlan): DrillDown['math'] {
  const note =
    'Bills due before your next payday come first, then this paycheck’s share of goals, trips and yearly costs. What is left is for everyday spending.'
  const spokenFor: MathTerm[] = [
    { label: 'bills before payday', value: { cents: plan.billsCents }, op: 'minus' },
    { label: 'set aside', value: { cents: plan.setAsideCents }, op: 'minus' },
  ]
  if (plan.paycheckCents === null) {
    return {
      terms: [{ label: 'Paycheck', value: { text: 'not added yet' } }, ...spokenFor],
      result: { label: 'Left for everyday spending', value: { text: 'not known yet' } },
      note: `${note} Add your pay to see what each paycheck leaves. Until then, the figure is what is safe to spend now.`,
    }
  }
  const left = plan.leftCents ?? 0
  return {
    terms: [{ label: 'Paycheck', value: { cents: plan.paycheckCents, tone: 'in' } }, ...spokenFor],
    result: {
      label: 'Left for everyday spending',
      value: { cents: left, tone: left < 0 ? 'warn' : 'neutral' },
    },
    note,
  }
}

/** One line of the plan: its name, what kind it is and, for a bill, when it is due. */
function lineRow(line: PlanLine, index: number, date: Dates): DrillItem {
  const due = line.dueDate && (line.overdue ? 'overdue' : `due ${date(line.dueDate)}`)
  return {
    key: `${line.kind}-${index}`,
    label: line.name,
    detail: [LINE_WORDS[line.kind], due].filter(Boolean).join(', '),
    value: { cents: line.amountCents, tone: line.overdue ? 'warn' : 'neutral' },
  }
}

/** The new paycheck's plan: what it covers before payday, and what is left. */
export function planDrill(plan: PaycheckPlan, date: Dates): DrillDown {
  const math = planMath(plan)
  return {
    title: 'This paycheck',
    subtitle: `Until payday ${date(plan.nextPayday)}. ${SUGGESTIONS_ONLY}`,
    // Without pay the math has no total, so the figure is safe to spend, as the card's is.
    figure: plan.paycheckCents === null ? { cents: plan.safeToSpendCents } : math.result.value,
    math,
    items:
      plan.lines.length > 0
        ? { title: 'What it covers', rows: plan.lines.map((line, i) => lineRow(line, i, date)) }
        : undefined,
  }
}
