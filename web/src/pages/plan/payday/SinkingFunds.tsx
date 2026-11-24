// Sinking funds on Payday: yearly and irregular costs (insurance, a
// registration, the holidays) saved toward a little each paycheck, so none
// lands all at once. The total opens its math; the costs Leeway found are
// added or waved off in one tap; any other is added by hand. Each fund's
// share is held back from safe to spend like a goal's.

import { useState } from 'react'
import type { SinkingFundsView } from '../../../api/client'
import { useAction, useActionMutation } from '../../../api/hooks'
import { Card } from '../../../components/design/Card'
import { KeyFigure } from '../../../components/design/KeyFigure'
import { Money } from '../../../components/design/Money'
import { SectionHead } from '../../../components/design/SectionHead'
import { ErrorNote, LoadingOrError } from '../../../components/ui'
import { useApp } from '../../../lib/app'
import { fundsDrill } from '../../../lib/drills/funds'
import { dayLabel } from '../../../lib/format'
import { FormCard } from '../FormCard'
import { FundForm } from './FundForm'
import { basisWords, FUND_CADENCE_WORDS, shareWords, suggestionInput } from './fundText'

type Suggestion = SinkingFundsView['suggestions'][number]

/** The day as the owner's locale writes it, like "Mon, Mar 1". */
function useDate() {
  const { settings } = useApp()
  return (iso: string) => dayLabel(iso, settings.locale)
}

/** What the funds come to each paycheck, opening the math cost by cost. */
function FundsTotal({ view }: { view: SinkingFundsView }) {
  const date = useDate()
  const next = view.funds[0]!
  const count = view.funds.length
  return (
    <Card drill={fundsDrill(view, date)} label="Yearly costs" className="stack-sm">
      <SectionHead icon="piggy" title="Yearly costs" />
      <KeyFigure
        label={`Set aside ${shareWords(view)}`}
        cents={view.totalShareCents}
        caption={
          <>
            For {count === 1 ? 'one cost' : `${count} costs`}, so none lands all at once. Next up:{' '}
            <b>{next.name}</b>, {date(next.nextDueDate)}.
          </>
        }
      />
    </Card>
  )
}

/** One cost Leeway found, with Add and Not needed beside it. */
function SuggestionRow({ suggestion, each }: { suggestion: Suggestion; each: string }) {
  const date = useDate()
  const add = useActionMutation('add_sinking_fund')
  const dismiss = useActionMutation('dismiss_sinking_fund')
  const { name, amountCents, cadence, dueDate, key } = suggestion
  return (
    <div className="list-row wrap">
      <span className="grow stack-sm" style={{ gap: 0, minWidth: 160 }}>
        <span style={{ fontWeight: 500 }}>{name}</span>
        <span className="small muted">
          <Money cents={amountCents} /> {FUND_CADENCE_WORDS[cadence]}, next {date(dueDate)}.{' '}
          <Money cents={suggestion.shareCents} /> {each}.
        </span>
        <span className="small muted">{basisWords(suggestion)}</span>
      </span>
      <button
        type="button"
        className="btn"
        disabled={add.isPending}
        onClick={() => add.mutate(suggestionInput(suggestion))}
      >
        Add
      </button>
      <button
        type="button"
        className="btn ghost"
        disabled={dismiss.isPending}
        onClick={() => dismiss.mutate({ key })}
      >
        Not needed
      </button>
      <ErrorNote error={add.error ?? dismiss.error} />
    </div>
  )
}

/** The costs Leeway found in the bills and the history. */
function Suggestions({ view }: { view: SinkingFundsView }) {
  const each = shareWords(view)
  return (
    <Card static="form" label="Worth saving for" className="stack-sm">
      <h2>Worth saving for</h2>
      <p className="small muted">Costs that come round once in a while.</p>
      {view.suggestions.map((suggestion) => (
        <SuggestionRow key={suggestion.key} suggestion={suggestion} each={each} />
      ))}
    </Card>
  )
}

/** The funds saved toward, each removable, and the button that adds one by hand. */
function FundList({ view, onAdd }: { view: SinkingFundsView; onAdd: () => void }) {
  const date = useDate()
  const remove = useActionMutation('delete_sinking_fund')
  return (
    <Card static="form" label="Saving for" className="stack-sm">
      {view.funds.length === 0 ? (
        <>
          <SectionHead icon="piggy" title="Yearly costs" />
          <p className="small muted">
            Insurance, registrations and the holidays come round once a year. Saving a little{' '}
            {shareWords(view)} means none lands all at once.
          </p>
        </>
      ) : (
        <h2>Saving for</h2>
      )}
      {view.funds.map((fund) => (
        <div key={fund.id} className="list-row wrap">
          <span className="grow stack-sm" style={{ gap: 0, minWidth: 140 }}>
            <span style={{ fontWeight: 500 }}>{fund.name}</span>
            <span className="small muted">
              <Money cents={fund.amountCents} /> {FUND_CADENCE_WORDS[fund.cadence]}, next{' '}
              {date(fund.nextDueDate)}
            </span>
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
      <div className="row">
        <button type="button" className="btn" onClick={onAdd}>
          Add a yearly cost
        </button>
      </div>
    </Card>
  )
}

export function SinkingFunds() {
  const view = useAction('list_sinking_funds')
  const [adding, setAdding] = useState(false)
  if (!view.data) return <LoadingOrError error={view.error} label="Loading yearly costs" />
  const data = view.data
  return (
    <>
      {data.funds.length > 0 && <FundsTotal view={data} />}
      {data.suggestions.length > 0 && <Suggestions view={data} />}
      <FundList view={data} onAdd={() => setAdding(true)} />
      {adding && (
        <FormCard title="New yearly cost">
          <FundForm onDone={() => setAdding(false)} />
        </FormCard>
      )}
    </>
  )
}
