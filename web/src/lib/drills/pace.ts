// The drill-down for the spending pace card. Pure: it takes what the card
// shows and returns a DrillDown for DrillSheet to draw.

import type { Budget, SpendingPace } from '../../api/client'
import type { DrillDown } from '../drill'
import { paths } from '../../routes'

/** Where flexible spending lands: spent so far plus the rest of the period at today's rate. */
export function paceDrill(pace: SpendingPace, budget: Budget, isCurrent: boolean): DrillDown {
  const spentCents = pace.cumulative.at(-1)?.cents ?? 0
  const landingCents = isCurrent ? pace.projectedCents : spentCents
  const followed = budget.categories.filter((row) => pace.categoryIds.includes(row.categoryId))
  const over = landingCents > pace.budgetCents
  return {
    title: 'Flexible spending pace',
    subtitle: `Day ${budget.period.daysElapsed} of ${budget.period.days}`,
    figure: { cents: landingCents, tone: over ? 'warn' : undefined },
    math: {
      terms: isCurrent
        ? [
            { label: 'Spent so far', value: { cents: spentCents } },
            {
              label: 'the rest of the period at this rate',
              value: { cents: landingCents - spentCents },
              op: 'plus',
            },
          ]
        : [{ label: 'Spent in the period', value: { cents: spentCents } }],
      result: { label: isCurrent ? 'Lands near' : 'Spent', value: { cents: landingCents } },
      note: 'Only flexible categories count: budgeted ones that follow pace, not fixed bills.',
    },
    usual: {
      currentCents: landingCents,
      usualCents: pace.budgetCents,
      goodWhen: 'down',
      basis: 'the flexible budget',
      heading: 'Compared with the budget',
    },
    items: {
      title: 'Categories followed',
      rows: followed.map((row) => ({
        key: row.categoryId,
        label: row.name,
        value: { cents: row.spentCents },
        // The category's page on the same period, so looking back stays looking back.
        to: paths.category(row.categoryId, budget.period.offset),
        icon: { category: { name: row.name, color: row.color, icon: row.icon, kind: row.kind } },
      })),
    },
    more: { to: paths.spending(budget.period.offset), label: 'Open budgets' },
  }
}
