// Drill-downs for the parts of an accounts view (summarize_accounts): money in
// and out, period by period, and this period's spending by category, for
// every account, a picked few, or one account's own page. Pure.

import type { AccountsView } from '../../api/client'
import type { DrillDown, DrillItem } from '../drill'

type Flow = AccountsView['flows'][number]
type Spent = AccountsView['spending'][number]

/** How a date range reads, in the owner's locale ("Nov 13 to Nov 26"). */
export type RangeLabel = (start: string, end: string) => string

/** Categories named in the math one by one; the rest are added up as one term. */
export const MATH_CATEGORIES = 4

/** What was left over in a period: money in less money out. */
export const leftOver = (flow: Flow) => flow.inCents - flow.outCents

/** The average of the earlier periods' money out; null with none before this one. */
export function usualOut(flows: readonly Flow[]): number | null {
  const earlier = flows.slice(0, -1)
  if (earlier.length === 0) return null
  return Math.round(earlier.reduce((sum, flow) => sum + flow.outCents, 0) / earlier.length)
}

/**
 * Money in and out of these accounts this period, against the periods before.
 * `flows` run oldest first and end with the current period so far.
 */
export function flowsDrill(
  flows: readonly Flow[],
  range: RangeLabel,
  money: (cents: number) => string,
): DrillDown | null {
  const current = flows.at(-1)
  if (!current) return null
  const usual = usualOut(flows)
  const rows: DrillItem[] = [...flows].reverse().map((flow, index) => ({
    key: flow.start,
    label: index === 0 ? `${range(flow.start, flow.end)}, so far` : range(flow.start, flow.end),
    detail: `In ${money(flow.inCents)}, out ${money(flow.outCents)}`,
    value: { cents: leftOver(flow), sign: 'change', tone: leftOver(flow) > 0 ? 'in' : undefined },
  }))
  return {
    title: 'Money in and out',
    subtitle: range(current.start, current.end),
    figure: {
      cents: leftOver(current),
      sign: 'change',
      tone: leftOver(current) > 0 ? 'in' : undefined,
    },
    math: {
      terms: [
        { label: 'Money in', value: { cents: current.inCents, sign: 'change', tone: 'in' } },
        { label: 'money out', value: { cents: current.outCents }, op: 'minus' },
      ],
      result: { label: 'Left over so far', value: { cents: leftOver(current), sign: 'change' } },
      note: 'Transfers between your own accounts are left out, so nothing counts twice.',
    },
    usual:
      usual === null
        ? undefined
        : {
            currentCents: current.outCents,
            usualCents: usual,
            goodWhen: 'down',
            basis: `the average of the last ${flows.length - 1} periods`,
            subject: 'out',
          },
    items: { title: 'Each period, newest first', rows },
    more: { to: '/transactions', label: 'See the transactions' },
  }
}

/** Where a category's row opens: its own page, or the spending still to sort. */
function categoryLink(spent: Spent): string {
  return spent.categoryId
    ? `/budgets/${encodeURIComponent(spent.categoryId)}`
    : '/transactions?category=uncategorized'
}

/** This period's spending on these accounts, category by category, biggest first. */
export function spendingDrill(
  spending: readonly Spent[],
  period: { start: string; end: string },
  range: RangeLabel,
): DrillDown {
  const total = spending.reduce((sum, spent) => sum + spent.spentCents, 0)
  const named = spending.slice(0, MATH_CATEGORIES)
  const restCents = total - named.reduce((sum, spent) => sum + spent.spentCents, 0)
  const terms = named.map((spent, index) => ({
    label: spent.name,
    value: { cents: spent.spentCents },
    op: index === 0 ? undefined : ('plus' as const),
  }))
  if (restCents > 0) {
    terms.push({ label: 'everything else', value: { cents: restCents }, op: 'plus' })
  }
  return {
    title: 'Spending by category',
    subtitle: range(period.start, period.end),
    figure: { cents: total },
    math: {
      terms: terms.length > 0 ? terms : [{ label: 'No spending yet', value: { cents: 0 } }],
      result: { label: 'Spent this period', value: { cents: total } },
    },
    items:
      spending.length > 0
        ? {
            title: 'Categories',
            rows: spending.map((spent) => ({
              key: spent.categoryId ?? 'none',
              label: spent.name,
              value: { cents: spent.spentCents },
              to: categoryLink(spent),
            })),
          }
        : undefined,
    more: { to: '/transactions', label: 'See the transactions' },
  }
}
