// Yearly costs on Goals (the server calls them sinking funds), all in one
// card: what the yearly and irregular costs (insurance, a registration, the
// holidays) hold back each budget period on top, opening its math; the costs
// Leeway found, added or waved off in one tap; and the funds themselves,
// opened on request. The figure is the very amount safe to spend holds back,
// so the two never disagree. Payday only totals it, linking here.

import { useState } from 'react'
import type { SinkingFundsView } from '../../../../api/client'
import { useAction } from '../../../../api/hooks'
import { Card } from '../../../../components/design/Card'
import { KeyFigure } from '../../../../components/design/KeyFigure'
import { SectionHead } from '../../../../components/design/SectionHead'
import { LoadingOrError } from '../../../../components/ui'
import { useApp } from '../../../../lib/app'
import { fundsDrill } from '../../../../lib/drills/funds'
import { periodWord } from '../../../../lib/format'
import { FormCard } from '../../FormCard'
import { FundForm } from './FundForm'
import { FundList, ShortNote, Suggestions, useDate } from './FundRows'
import { firstShort } from './fundText'

/** The budget period's name in everyday words, like "month". */
function usePeriodWord() {
  return periodWord(useApp().settings.period.kind)
}

function AddButton({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="row">
      <button type="button" className="btn" onClick={onAdd}>
        Add a yearly cost
      </button>
    </div>
  )
}

/** Under the total: the next cost due, or the soonest one its shares will not cover in time. */
function Caption({ view }: { view: SinkingFundsView }) {
  const date = useDate()
  const short = firstShort(view)
  if (short) {
    return (
      <>
        <b>{short.name}</b>: <ShortNote fund={short} />
      </>
    )
  }
  const next = view.funds[0]!
  const count = view.funds.length
  return (
    <>
      For {count === 1 ? 'one cost' : `${count} costs`}, so none lands all at once. Next up:{' '}
      <b>{next.name}</b>, {date(next.nextDueDate)}.
    </>
  )
}

/** Inside the card, under the total: suggestions, then the funds behind a toggle. */
function Inside({ view, onAdd }: { view: SinkingFundsView; onAdd: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="stack-sm">
      <Suggestions view={view} />
      <button
        type="button"
        className="linkbtn small tap"
        aria-expanded={open}
        style={{ alignSelf: 'flex-start' }}
        onClick={() => setOpen(!open)}
      >
        {open ? 'Hide costs' : 'Your costs'}
      </button>
      {open && (
        <>
          <FundList view={view} />
          <AddButton onAdd={onAdd} />
        </>
      )}
    </div>
  )
}

/** The one card: an invitation before any fund, the total and its parts after. */
function YearlyCostsCard({ view, onAdd }: { view: SinkingFundsView; onAdd: () => void }) {
  const word = usePeriodWord()
  const date = useDate()
  if (view.funds.length === 0) {
    return (
      <Card static="form" label="Yearly costs" className="stack-sm">
        <SectionHead icon="piggy" title="Yearly costs" />
        <p className="small muted">
          Insurance, registrations and the holidays come round once a year. Saving a little each{' '}
          {word} means none lands all at once.
        </p>
        <Suggestions view={view} />
        <AddButton onAdd={onAdd} />
      </Card>
    )
  }
  return (
    <Card
      drill={fundsDrill(view, date, word)}
      below={<Inside view={view} onAdd={onAdd} />}
      label="Yearly costs"
      className="stack-sm"
    >
      <SectionHead icon="piggy" title="Yearly costs" />
      <KeyFigure
        label={`Set aside each ${word}`}
        cents={view.totalPerPeriodCents}
        caption={<Caption view={view} />}
      />
    </Card>
  )
}

export function YearlyCosts() {
  const view = useAction('list_sinking_funds')
  const [adding, setAdding] = useState(false)
  if (!view.data) return <LoadingOrError error={view.error} label="Loading yearly costs" />
  return (
    <>
      <YearlyCostsCard view={view.data} onAdd={() => setAdding(true)} />
      {adding && (
        <FormCard title="New yearly cost">
          <FundForm onDone={() => setAdding(false)} />
        </FormCard>
      )}
    </>
  )
}
