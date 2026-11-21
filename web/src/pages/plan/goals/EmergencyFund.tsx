// The emergency fund: offered in one tap when there is none (one month of
// essential spending, from real spending), then shown as the goal it became,
// with the next step (three months, then six) and the accounts it counts.

import { useState } from 'react'
import type { Goal } from '../../../api/client'
import { useActionMutation } from '../../../api/hooks'
import { Card } from '../../../components/design/Card'
import { Money } from '../../../components/design/Money'
import { ErrorNote, Progress } from '../../../components/ui'
import { FundAccountsForm } from './FundAccounts'
import { countedWords, essentialsWords, monthsWord, type EmergencyView } from './emergencyText'

/** The one-tap offer, when there is no emergency fund yet. */
export function EmergencyOffer({ view }: { view: EmergencyView }) {
  const start = useActionMutation('start_emergency_fund')
  return (
    <Card static="form" label="Start an emergency fund" className="stack-sm emergency-offer">
      <span className="eyebrow">Emergency fund</span>
      <h2>Start with one month of essentials</h2>
      <Money cents={view.targetCents} className="mid-number" />
      <p className="small muted">
        What {essentialsWords(view.essentials)} cost in a typical month.
      </p>
      {view.next && (
        <p className="small muted">
          Then aim for {monthsWord(view.next.months)}: <Money cents={view.next.targetCents} />.
        </p>
      )}
      <div className="row wrap">
        <button
          type="button"
          className="btn primary"
          disabled={start.isPending}
          onClick={() => start.mutate({})}
        >
          Start my emergency fund
        </button>
      </div>
      <ErrorNote error={start.error} />
    </Card>
  )
}

/** The step after this one, as a button; primary once this step is reached. */
function NextStep({ view, reached }: { view: EmergencyView; reached: boolean }) {
  const change = useActionMutation('change_emergency_fund')
  if (!view.next) return null
  const { months, targetCents } = view.next
  return (
    <>
      <div className="row wrap">
        <button
          type="button"
          className={reached ? 'btn primary' : 'btn'}
          disabled={change.isPending}
          onClick={() => change.mutate({ months })}
        >
          Aim for {monthsWord(months)}: <Money cents={targetCents} />
        </button>
      </div>
      <ErrorNote error={change.error} />
    </>
  )
}

/** The emergency fund goal's card, in the goals grid where the goal ranks. */
export function EmergencyCard({
  goal,
  view,
  onEdit,
}: {
  goal: Goal
  view: EmergencyView
  onEdit: () => void
}) {
  const [choosing, setChoosing] = useState(false)
  const reached = goal.status === 'reached'
  return (
    <Card static="form" label={goal.name} className="span-6 stack-sm">
      <div className="row-between">
        <h2>{goal.name}</h2>
        <button type="button" className="linkbtn tap" onClick={onEdit}>
          Edit
        </button>
      </div>
      <span className="badge accent">{monthsWord(view.months)} of essentials</span>
      <div className="row wrap" style={{ alignItems: 'baseline' }}>
        <Money cents={goal.currentCents} className="mid-number" />
        <span className="muted">
          of <Money cents={goal.targetCents} />
        </span>
      </div>
      <Progress percent={goal.percent} color={goal.color} aria-label={`${goal.name} progress`} />
      {reached ? (
        <span className="small good">You have {monthsWord(view.months)} put by. Nice work.</span>
      ) : (
        <span className="small">
          <Money cents={goal.remainingCents} /> to go.
        </span>
      )}
      <NextStep view={view} reached={reached} />
      <p className="small muted">
        Counts {countedWords(view)}.{' '}
        <button type="button" className="linkbtn small tap" onClick={() => setChoosing(!choosing)}>
          {choosing ? 'Close' : 'Change'}
        </button>
      </p>
      {choosing && <FundAccountsForm view={view} onDone={() => setChoosing(false)} />}
    </Card>
  )
}
