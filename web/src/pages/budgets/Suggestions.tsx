// Suggested budgets from recent spending, applied one at a time or all at once.

import { useState } from 'react'
import { useAction, useActionMutation } from '../../api/hooks'
import { Card, ErrorNote, Loading } from '../../components/ui'
import { useApp } from '../../lib/app'
import { periodLabel } from '../../lib/format'
import { Money } from '../../components/design/Money'

/** Budgets based on the last three full months, applied one at a time or all at once. */
export function Suggestions({ onClose }: { onClose: () => void }) {
  const { money, settings } = useApp()
  const result = useAction('suggest_budgets')
  const update = useActionMutation('update_category')
  const [applying, setApplying] = useState(false)
  const rows = result.data?.suggestions ?? []
  const differs = rows.filter(
    (s) => s.currentBudgetCents !== s.suggestedMonthlyCents || s.currentCadence !== 'month',
  )

  async function apply(list: typeof rows) {
    setApplying(true)
    try {
      for (const s of list) {
        await update.mutateAsync({
          id: s.categoryId,
          budgetCents: s.suggestedMonthlyCents,
          budgetCadence: 'month',
        })
      }
    } catch {
      // The mutation keeps the error, and the ErrorNote below shows it; stop at the first failure.
    } finally {
      setApplying(false)
    }
  }

  return (
    <Card label="Suggested budgets" className="stack-sm">
      <div className="row-between">
        <h2>Suggested monthly budgets</h2>
        <button type="button" className="linkbtn" onClick={onClose}>
          Close
        </button>
      </div>
      {result.isPending && <Loading />}
      {result.data && (
        <span className="small muted">
          From what you spent {periodLabel(result.data.from, result.data.to, settings.locale)},
          rounded up a little.
        </span>
      )}
      {result.isSuccess && rows.length === 0 && (
        <p className="empty">
          Not enough history yet. Suggestions appear once a bank has a few weeks of spending.
        </p>
      )}
      {rows.map((s) => (
        <div key={s.categoryId} className="list-row wrap">
          <span className="grow">{s.name}</span>
          <span className="small muted">
            you average <Money cents={s.averageMonthlyCents} />
            {s.currentBudgetCents !== null && `, budget now ${money(s.currentBudgetCents)}`}
          </span>
          <strong>
            <Money cents={s.suggestedMonthlyCents} />
          </strong>
          <button
            type="button"
            className="btn small"
            disabled={applying || !differs.includes(s)}
            onClick={() => void apply([s])}
          >
            {differs.includes(s) ? 'Use' : 'In use'}
          </button>
        </div>
      ))}
      {differs.length > 1 && (
        <div>
          <button
            type="button"
            className="btn primary"
            disabled={applying}
            onClick={() => void apply(differs)}
          >
            Use all {differs.length}
          </button>
        </div>
      )}
      <ErrorNote error={result.error ?? update.error} />
    </Card>
  )
}
