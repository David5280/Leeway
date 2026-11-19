// Drill-downs for the spending pace card and the bank sync tile. Pure: each
// takes what the card shows and returns a DrillDown for DrillSheet to draw.

import type { Budget, Connection, SpendingPace } from '../../api/client'
import type { DrillDown } from '../drill'

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
    },
    items: {
      title: 'Categories followed',
      rows: followed.map((row) => ({
        key: row.categoryId,
        label: row.name,
        value: { cents: row.spentCents },
        to: `/budgets/${row.categoryId}`,
        icon: { category: { name: row.name, color: row.color, icon: row.icon, kind: row.kind } },
      })),
    },
    more: { to: '/budgets', label: 'Open budgets' },
  }
}

/** The banks that sync, which need the owner, and how many accounts each brings. */
export function syncDrill(
  connections: Connection[],
  ago: (at: string | null) => string,
): DrillDown {
  const needYou = connections.filter((connection) => connection.status !== 'active')
  const accounts = connections.reduce((sum, connection) => sum + connection.accountCount, 0)
  const banks = (count: number) => `${count} ${count === 1 ? 'bank' : 'banks'}`
  return {
    title: 'Bank sync',
    figure: {
      text: needYou.length > 0 ? 'Needs you' : 'Up to date',
      tone: needYou.length > 0 ? 'warn' : undefined,
    },
    math: {
      terms: [
        { label: 'Banks connected', value: { text: banks(connections.length) } },
        { label: 'need you to sign in again', value: { text: banks(needYou.length) }, op: 'minus' },
      ],
      result: {
        label: 'Syncing on their own',
        value: { text: banks(connections.length - needYou.length) },
      },
      note: `${accounts} ${accounts === 1 ? 'account comes' : 'accounts come'} in from your banks. Leeway only reads them; nothing ever moves money.`,
    },
    items: {
      title: 'Banks',
      rows: connections.map((connection) => ({
        key: connection.id,
        label: connection.institutionName ?? 'Bank',
        detail:
          connection.status === 'active'
            ? `Synced ${ago(connection.lastSyncedAt)}`
            : 'Needs you to sign in again',
      })),
    },
    more: { to: '/settings/banks', label: 'Manage banks' },
  }
}
