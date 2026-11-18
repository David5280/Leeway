// Money put toward a goal counted by hand: "I put $50 toward it", and a short
// history of what was recorded. Recording only keeps count; no money moves.

import { useState } from 'react'
import type { Goal } from '../../../api/client'
import { useAction, useActionMutation } from '../../../api/hooks'
import { ErrorNote, Loading } from '../../../components/ui'
import { useApp } from '../../../lib/app'
import { longDate, parseMoney } from '../../../lib/format'

/** How many recent entries the history shows. */
const HISTORY_SIZE = 5

/** Put money toward a goal counted by hand, or take some back with a minus sign. */
export function AddMoney({ goal }: { goal: Goal }) {
  const [amount, setAmount] = useState('')
  const add = useActionMutation('add_to_goal')
  const cents = parseMoney(amount)
  return (
    <form
      className="row wrap"
      aria-label={`Add to ${goal.name}`}
      onSubmit={(event) => {
        event.preventDefault()
        add.mutate({ id: goal.id, amountCents: cents! }, { onSuccess: () => setAmount('') })
      }}
    >
      <span className="small muted">I put</span>
      <input
        className="input num"
        style={{ width: 110 }}
        inputMode="decimal"
        aria-label={`Amount to add to ${goal.name}`}
        placeholder="$50"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
      />
      <span className="small muted">toward it</span>
      <button type="submit" className="btn" disabled={!cents || add.isPending}>
        Add
      </button>
      <ErrorNote error={add.error} />
    </form>
  )
}

/** The latest amounts recorded, newest first, loaded once opened. */
function HistoryList({ goal }: { goal: Goal }) {
  const { exact, settings } = useApp()
  const history = useAction('list_goal_contributions', { id: goal.id, limit: HISTORY_SIZE })
  if (!history.data) {
    return history.error ? <ErrorNote error={history.error} /> : <Loading />
  }
  if (history.data.length === 0) {
    return <p className="small muted">Nothing recorded yet. Amounts you add show up here.</p>
  }
  return (
    <ul className="plain-list small" aria-label={`${goal.name} history`}>
      {history.data.map((entry) => (
        <li key={entry.id} className="row-between">
          <span className="muted">{longDate(entry.date, settings.locale)}</span>
          {/* Taking money back reads as a minus, putting it in as a plus. */}
          <span className={`num ${entry.amountCents > 0 ? 'good' : ''}`}>
            {entry.amountCents > 0 ? '+' : '-'}
            {exact(Math.abs(entry.amountCents))}
          </span>
        </li>
      ))}
    </ul>
  )
}

/** A toggle that shows the history under it. */
export function History({ goal }: { goal: Goal }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="stack-sm">
      <button
        type="button"
        className="linkbtn small"
        aria-expanded={open}
        style={{ alignSelf: 'flex-start' }}
        onClick={() => setOpen(!open)}
      >
        {open ? 'Hide history' : 'History'}
      </button>
      {open && <HistoryList goal={goal} />}
    </div>
  )
}
