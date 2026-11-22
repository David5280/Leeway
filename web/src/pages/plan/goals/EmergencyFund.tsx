// The emergency fund: offered in one tap when there is none (one month of
// essential spending, from real spending), then shown as the goal it became.
// Each card's figure opens its drill-down (lib/drills/emergency.ts); under it
// sit the next step (three months, then six), the essentials it is sized by
// and the accounts it counts, each with its own control.

import { useState } from 'react'
import type { Goal } from '../../../api/client'
import { useActionMutation } from '../../../api/hooks'
import { Card } from '../../../components/design/Card'
import { Money } from '../../../components/design/Money'
import { ErrorNote, Progress } from '../../../components/ui'
import { emergencyFundDrill, emergencyOfferDrill } from '../../../lib/drills/emergency'
import {
  countedWords,
  essentialsWords,
  leftOutNotes,
  monthsWord,
  targetWords,
  type EmergencyView,
} from '../../../lib/emergencyText'
import { AddMoney, History } from './Contributions'
import { EssentialCategoriesForm } from './EssentialCategories'
import { FundAccountsForm } from './FundAccounts'

/**
 * "What Rent, Groceries and 2 more cost in a typical month." The essentials
 * open a form to pick them, except bills, which have no categories to pick.
 */
function EssentialsLine({ view }: { view: EmergencyView }) {
  const [picking, setPicking] = useState(false)
  const essentials = view.essentials
  const words = essentialsWords(essentials)
  if (!essentials || essentials.from === 'bills') {
    return <p className="small muted">What {words} cost in a typical month.</p>
  }
  return (
    <>
      <p className="small muted">
        What{' '}
        <button
          type="button"
          className="linkbtn small tap"
          aria-expanded={picking}
          onClick={() => setPicking(!picking)}
        >
          {words}
        </button>{' '}
        cost in a typical month.
      </p>
      {picking && (
        <EssentialCategoriesForm essentials={essentials} onDone={() => setPicking(false)} />
      )}
    </>
  )
}

/** The one-tap offer, when there is no emergency fund yet. */
export function EmergencyOffer({ view }: { view: EmergencyView }) {
  const start = useActionMutation('start_emergency_fund')
  // Gone the moment the fund starts, before the goals reload to show it.
  if (start.isSuccess) return null
  return (
    <Card
      drill={emergencyOfferDrill(view)}
      below={
        <div className="stack-sm">
          <EssentialsLine view={view} />
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
        </div>
      }
      label="Start an emergency fund"
      className="stack-sm emergency-offer"
    >
      <span className="eyebrow">Emergency fund</span>
      <h2>Start with one month of essentials</h2>
      <Money cents={view.targetCents} className="mid-number" />
      {view.next && (
        <p className="small muted">
          Then aim for {monthsWord(view.next.months)}: <Money cents={view.next.targetCents} />.
        </p>
      )}
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

/** What the fund counts, why any account is left out, and the form to change it. */
function CountsLine({ view }: { view: EmergencyView }) {
  const [choosing, setChoosing] = useState(false)
  return (
    <>
      <p className="small muted">
        Counts {countedWords(view)}.{' '}
        <button
          type="button"
          className="linkbtn small tap"
          aria-expanded={choosing}
          onClick={() => setChoosing(!choosing)}
        >
          {choosing ? 'Close' : 'Change'}
        </button>
      </p>
      {leftOutNotes(view).map((note) => (
        <p key={note} className="small muted">
          {note}
        </p>
      ))}
      {choosing && <FundAccountsForm view={view} onDone={() => setChoosing(false)} />}
    </>
  )
}

/** How far along the fund is, in words: cheered once reached, otherwise what is left. */
function StatusLine({ goal, view }: { goal: Goal; view: EmergencyView }) {
  if (goal.status !== 'reached') {
    return (
      <span className="small">
        <Money cents={goal.remainingCents} /> to go.
      </span>
    )
  }
  const put = view.ownTarget || view.months === null ? 'your target' : monthsWord(view.months)
  return <span className="small good">You have {put} put by. Nice work.</span>
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
  return (
    <Card
      drill={emergencyFundDrill(view, goal.name)}
      below={
        <div className="stack-sm">
          <NextStep view={view} reached={goal.status === 'reached'} />
          <EssentialsLine view={view} />
          <CountsLine view={view} />
          {view.counts === 'hand' && (
            <>
              <AddMoney goal={goal} />
              <History goal={goal} />
            </>
          )}
          <div className="row wrap">
            <button type="button" className="linkbtn tap" onClick={onEdit}>
              Edit goal
            </button>
          </div>
        </div>
      }
      label={goal.name}
      className="span-6 stack-sm"
    >
      <h2>{goal.name}</h2>
      <span className="badge accent">{targetWords(view)}</span>
      <div className="row wrap" style={{ alignItems: 'baseline' }}>
        <Money cents={goal.currentCents} className="mid-number" />
        <span className="muted">
          of <Money cents={goal.targetCents} />
        </span>
      </div>
      <Progress percent={goal.percent} color={goal.color} aria-label={`${goal.name} progress`} />
      <StatusLine goal={goal} view={view} />
    </Card>
  )
}
