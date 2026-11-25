// The Spending tab: am I on budget? In the order the map gives it: what has
// gone out in your budgets this period against them, with what is left (the
// lead), then the flexible spending pace, budgets by category, the latest few
// transactions and the Trends row. The arrows by the title step back to
// earlier periods, here and only here, and every section follows them.
// A tap deeper: each category's page, all activity, spending over time and
// top merchants. Spending never shows a figure to spend: that is Home's.
// Budgets change only on the current period: Leeway keeps no budget history,
// so a past period is measured against today's budgets and shown read-only.

import { useState } from 'react'
import { useAction } from '../api/hooks'
import { Shell } from '../components/Shell'
import { LoadingOrError } from '../components/ui'
import { PaceCard } from '../widgets/Pace'
import { Suggestions } from './budgets/Suggestions'
import { BudgetsByCategory } from './spending/BudgetsByCategory'
import { LatestTransactions } from './spending/LatestTransactions'
import { useSpendingPeriod } from './spending/period'
import { SpendingHeader } from './spending/SpendingHeader'
import { SpendingLead } from './spending/SpendingLead'
import { TrendsRow } from './spending/TrendsRow'

/**
 * Where the budget suggestions are open: under the lead, whose button offers
 * them while nothing is budgeted, or in budgets by category. Each opens them
 * where its button is, so they are in view on a phone.
 */
type SuggestionsAt = 'lead' | 'budgets' | null

export function Spending() {
  const [period, setPeriod] = useSpendingPeriod()
  const [suggesting, setSuggesting] = useState<SuggestionsAt>(null)
  const budget = useAction('get_budget', { offset: period })
  const categories = useAction('list_categories')
  const ready = budget.data && categories.data

  return (
    <Shell>
      <SpendingHeader period={period} budget={budget.data} onStep={setPeriod} />
      {!ready ? (
        <LoadingOrError error={budget.error ?? categories.error} />
      ) : (
        <>
          <SpendingLead budget={budget.data} onSuggest={() => setSuggesting('lead')} />
          {period === 0 && suggesting === 'lead' && (
            <Suggestions onClose={() => setSuggesting(null)} />
          )}
          <PaceCard budget={budget.data} offset={period} />
          <BudgetsByCategory
            budget={budget.data}
            categories={categories.data}
            suggesting={suggesting === 'budgets'}
            onSuggesting={(open) => setSuggesting(open ? 'budgets' : null)}
          />
          <LatestTransactions budget={budget.data} />
          <TrendsRow period={period} />
        </>
      )}
    </Shell>
  )
}
