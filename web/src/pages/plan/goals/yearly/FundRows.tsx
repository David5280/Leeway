// The rows inside the Yearly costs card: the costs Leeway found, each added
// or waved off in one tap, and the funds saved toward, each removable.

import type { SinkingFundsView } from '../../../../api/client'
import { useActionMutation } from '../../../../api/hooks'
import { Money } from '../../../../components/design/Money'
import { ErrorNote } from '../../../../components/ui'
import { useApp } from '../../../../lib/app'
import { dayLabel } from '../../../../lib/format'
import { basisWords, FUND_CADENCE_WORDS, suggestionInput } from './fundText'

type Fund = SinkingFundsView['funds'][number]
type Suggestion = SinkingFundsView['suggestions'][number]

/** The day as the owner's locale writes it, like "Mon, Mar 1". */
export function useDate() {
  const { settings } = useApp()
  return (iso: string) => dayLabel(iso, settings.locale)
}

/** A cost and when it lands: "$780 a year, next Mon, Mar 1". */
function CostLine({
  cost,
  dueDate,
}: {
  cost: Pick<Fund, 'amountCents' | 'cadence'>
  dueDate: string
}) {
  const date = useDate()
  return (
    <>
      <Money cents={cost.amountCents} /> {FUND_CADENCE_WORDS[cost.cadence]}, next {date(dueDate)}
    </>
  )
}

/**
 * The calm note for a fund whose shares will not cover it in time:
 * "$520 short by Mon, Mar 1, set aside more now." Never red: it is a nudge.
 */
export function ShortNote({ fund }: { fund: Fund }) {
  const date = useDate()
  return (
    <>
      <Money cents={fund.shortCents} /> short by {date(fund.nextDueDate)}, set aside more now.
    </>
  )
}

/** One cost Leeway found, with Add and Not needed beside it. */
function SuggestionRow({ suggestion }: { suggestion: Suggestion }) {
  const add = useActionMutation('add_sinking_fund')
  const dismiss = useActionMutation('dismiss_sinking_fund')
  return (
    <div className="list-row wrap">
      <span className="grow stack-sm" style={{ gap: 0, minWidth: 160 }}>
        <span style={{ fontWeight: 500 }}>{suggestion.name}</span>
        <span className="small muted">
          <CostLine cost={suggestion} dueDate={suggestion.dueDate} />. {basisWords(suggestion)}.
        </span>
      </span>
      <button
        type="button"
        className="btn small"
        disabled={add.isPending}
        onClick={() => add.mutate(suggestionInput(suggestion))}
      >
        Add
      </button>
      <button
        type="button"
        className="btn ghost small"
        disabled={dismiss.isPending}
        onClick={() => dismiss.mutate({ key: suggestion.key })}
      >
        Not needed
      </button>
      <ErrorNote error={add.error ?? dismiss.error} />
    </div>
  )
}

/** The costs Leeway found in the bills and the history, under a short heading. */
export function Suggestions({ view }: { view: SinkingFundsView }) {
  if (view.suggestions.length === 0) return null
  return (
    <div role="group" aria-label="Worth saving for" className="stack-sm" style={{ gap: 0 }}>
      <span className="small muted">Worth saving for</span>
      {view.suggestions.map((suggestion) => (
        <SuggestionRow key={suggestion.key} suggestion={suggestion} />
      ))}
    </div>
  )
}

/** The funds saved toward, each with when it lands and a Remove button. */
export function FundList({ view }: { view: SinkingFundsView }) {
  const remove = useActionMutation('delete_sinking_fund')
  return (
    <div role="group" aria-label="Saving for" className="stack-sm" style={{ gap: 0 }}>
      {view.funds.map((fund) => (
        <div key={fund.id} className="list-row wrap">
          <span className="grow stack-sm" style={{ gap: 0, minWidth: 140 }}>
            <span style={{ fontWeight: 500 }}>{fund.name}</span>
            <span className="small muted">
              <CostLine cost={fund} dueDate={fund.nextDueDate} />
            </span>
            {fund.shortCents > 0 && (
              <span className="small">
                <ShortNote fund={fund} />
              </span>
            )}
          </span>
          <button
            type="button"
            className="btn ghost small"
            aria-label={`Remove ${fund.name}`}
            disabled={remove.isPending}
            onClick={() => remove.mutate({ id: fund.id })}
          >
            Remove
          </button>
        </div>
      ))}
      <ErrorNote error={remove.error} />
    </div>
  )
}
