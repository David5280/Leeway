// Drill-downs for the planning widgets an owner can add to the Overview: cash
// until payday, net worth, debt payoff, and the top merchants. Pure: each
// takes what its widget already read and returns a DrillDown for DrillSheet.

import type { CashFlow, DebtPlans, NetWorth, Output } from '../../api/client'
import { shortTone } from '../cashPath'
import type { DrillDown } from '../drill'
import { startReference, worthChange } from '../worth'
import { paths } from '../../routes'

type Merchants = Output<'top_merchants'>

/** When the cash runs to: payday, a projected payday, or the period's end. */
function untilLabel(flow: CashFlow, date: (iso: string) => string): string {
  if (flow.paydaySource === 'period_end')
    return `To ${date(flow.nextPayday)}, when the budget period ends`
  return flow.paydayEstimate
    ? `Payday about ${date(flow.nextPayday)}, a best guess until more paychecks come`
    : `Payday ${date(flow.nextPayday)}`
}

/** Why the cash falls short: the bills, the overdraft, or both. */
function shortNote(flow: CashFlow): string {
  if (flow.billsDueCents === 0) return 'An overdrawn account needs this much to get back to zero.'
  const owed = flow.overdraftCents > 0 ? 'The bills and the overdraft' : 'The bills'
  // Against a guessed payday some of those bills may fall after pay comes.
  return flow.paydayEstimate
    ? `${owed} due before payday may come to more than checking holds.`
    : `${owed} due before payday come to more than checking holds.`
}

/** Safe to spend until payday: checking, less the bills due first and any overdraft. */
export function cashFlowDrill(flow: CashFlow, date: (iso: string) => string): DrillDown {
  const short = flow.shortfallCents > 0
  const overdraft =
    flow.overdraftCents > 0
      ? [
          {
            label: 'to bring an overdraft back to zero',
            value: { cents: flow.overdraftCents },
            op: 'minus' as const,
          },
        ]
      : []
  const bills = {
    label: 'bills due before payday',
    value: { cents: flow.billsDueCents },
    op: 'minus' as const,
  }
  // No checking balance yet: unknown, never $0 in checking and $0 safe to spend.
  const unknown = { text: 'Not known yet' }
  const math: DrillDown['math'] = !flow.cashKnown
    ? {
        terms: [{ label: 'In checking', value: unknown }, bills],
        result: { label: 'Safe to spend', value: unknown },
        note: "Checking's balance isn't known yet, so what is safe to spend isn't either.",
      }
    : {
        terms: [{ label: 'In checking', value: { cents: flow.cashCents } }, bills, ...overdraft],
        result: short
          ? { label: 'Short by', value: { cents: flow.shortfallCents, tone: shortTone(flow) } }
          : { label: 'Safe to spend', value: { cents: flow.safeCents } },
        note: short
          ? shortNote(flow)
          : 'Day-to-day spending until payday comes out of this. Savings is not counted.',
      }
  return {
    title: 'Until payday',
    subtitle: untilLabel(flow, date),
    // The figure is the answer the math comes to.
    figure: math.result.value,
    math,
    items:
      flow.billsDue.length > 0
        ? {
            title: 'Bills due before payday',
            rows: flow.billsDue.map((bill) => ({
              key: `${bill.billId}-${bill.dueDate}`,
              label: bill.name,
              detail: bill.overdue ? 'No payment found yet' : `Due ${date(bill.dueDate)}`,
              value: { cents: bill.amountCents },
              to: paths.bills(),
            })),
          }
        : undefined,
    more: { to: paths.payday(), label: 'Open payday' },
  }
}

/** What is owned, less what is owed, with its year as the trend. */
export function netWorthDrill(worth: NetWorth): DrillDown {
  const negative = worth.netWorthCents < 0
  return {
    title: 'Net worth',
    figure: { cents: worth.netWorthCents, tone: negative ? 'problem' : undefined },
    math: {
      terms: [
        { label: 'What you own', value: { cents: worth.assetsCents } },
        { label: 'what you owe', value: { cents: worth.liabilitiesCents }, op: 'minus' },
      ],
      result: {
        label: 'Net worth',
        value: { cents: worth.netWorthCents, tone: negative ? 'problem' : undefined },
      },
      note: 'Accounts you ignore for budgets are left out.',
    },
    trend:
      worth.history.length > 1
        ? {
            points: worth.history.map((point) => ({
              date: point.date,
              cents: point.netWorthCents,
            })),
            label: 'Net worth over the last year',
            description: 'What you own less what you owe, each day a balance changed.',
            reference: startReference(worthChange(worth)),
          }
        : undefined,
    more: { to: paths.wealth(), label: 'Open net worth' },
  }
}

/**
 * The cheapest way out of debt (highest rate first) at the minimums: what is
 * owed, what goes to it each month, and when each debt clears.
 */
export function debtsDrill(
  plans: DebtPlans,
  duration: (months: number | null) => string,
): DrillDown {
  const plan = plans.avalanche
  const owedCents = plans.debts.reduce((sum, debt) => sum + debt.balanceCents, 0)
  return {
    title: 'Debt payoff',
    subtitle: 'Highest rate first, paying the minimums',
    figure: { text: duration(plan.months) },
    math: {
      terms: [
        { label: 'Owed now', value: { cents: owedCents } },
        { label: 'interest along the way', value: { cents: plan.totalInterestCents }, op: 'plus' },
      ],
      result: { label: 'Paid in all', value: { cents: owedCents + plan.totalInterestCents } },
      note: 'Paying more than the minimums each month clears it sooner and costs less.',
    },
    items: {
      title: 'When each clears',
      rows: plan.debts.map((debt) => ({
        key: debt.id,
        label: debt.name,
        detail: duration(debt.months),
        value: { cents: debt.interestCents },
        to: paths.debts(),
      })),
    },
    more: { to: paths.debts(), label: 'Plan it' },
  }
}

/** How many merchants the math names one by one; the rest are one term. */
const NAMED = 4

/** The merchants spent at most this period, added up. */
export function merchantsDrill(merchants: Merchants): DrillDown {
  const total = merchants.reduce((sum, one) => sum + one.spentCents, 0)
  const named = merchants.slice(0, NAMED)
  const restCents = total - named.reduce((sum, one) => sum + one.spentCents, 0)
  const terms = named.map((one, index) => ({
    label: one.merchant,
    value: { cents: one.spentCents },
    op: index === 0 ? undefined : ('plus' as const),
  }))
  if (restCents > 0) terms.push({ label: 'the rest', value: { cents: restCents }, op: 'plus' })
  return {
    title: 'Top merchants',
    figure: { cents: total },
    math: {
      terms: terms.length > 0 ? terms : [{ label: 'No spending yet', value: { cents: 0 } }],
      result: { label: 'Spent at these merchants', value: { cents: total } },
      note: 'Lines the bank sent with no readable merchant are left out.',
    },
    items:
      merchants.length > 0
        ? {
            title: 'Merchants',
            rows: merchants.map((one) => ({
              key: one.merchant,
              label: one.merchant,
              detail: `${one.count} ${one.count === 1 ? 'charge' : 'charges'}`,
              value: { cents: one.spentCents },
            })),
          }
        : undefined,
    more: { to: paths.activity(), label: 'See the transactions' },
  }
}
