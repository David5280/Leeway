// The monthly amount that fills goals in order: said in a line with a way to
// change it, or asked for once when Leeway has seen nothing go into goals yet.
// An amount the owner set can be handed back to the pace Leeway sees.

import { useId, useState, type FormEvent } from 'react'
import { useActionMutation } from '../../../api/hooks'
import { Money } from '../../../components/design/Money'
import { ErrorNote } from '../../../components/ui'
import { parseMoney } from '../../../lib/format'
import type { GoalOrder } from './orderText'

/** The question the amount's field answers, which is also the field's name. */
const PROMPT = 'How much can you put toward goals each month?'

/** The amount's field and its buttons: Save, and while changing it, Cancel and the way back to the pace. */
function AmountForm({
  start,
  canUsePace,
  onDone,
  onCancel,
}: {
  start: number | null
  /** Whether the amount is the owner's own, so it can go back to the pace seen. */
  canUsePace: boolean
  onDone: () => void
  /** Closes the form unchanged; absent when the form is the only way to give an amount. */
  onCancel?: () => void
}) {
  const fieldId = useId()
  const save = useActionMutation('update_settings')
  const [text, setText] = useState(start === null ? '' : String(start / 100))
  const cents = parseMoney(text)
  const saveAmount = (goalsMonthlyCents: number | null) =>
    save.mutate({ savingsPlan: { goalsMonthlyCents } }, { onSuccess: onDone })

  function submit(event: FormEvent) {
    event.preventDefault()
    if (cents !== null) saveAmount(cents)
  }

  return (
    <form className="stack-sm" onSubmit={submit}>
      <label className="small" htmlFor={fieldId}>
        {PROMPT}
      </label>
      <span className="row wrap">
        <input
          id={fieldId}
          className="input num"
          style={{ width: 130 }}
          inputMode="decimal"
          placeholder="0"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <button type="submit" className="btn primary" disabled={cents === null || save.isPending}>
          Save
        </button>
        {onCancel && (
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
        )}
      </span>
      {canUsePace && (
        <button
          type="button"
          className="linkbtn small tap"
          disabled={save.isPending}
          onClick={() => saveAmount(null)}
        >
          Use my recent pace instead
        </button>
      )}
      <ErrorNote error={save.error} />
    </form>
  )
}

/** The line that says how goals fill, without its Change button. */
function AmountLine({ order }: { order: GoalOrder }) {
  if (order.monthlyCents === 0) return <>Set an amount to see dates.</>
  const amount = <Money cents={order.monthlyCents} />
  const whose =
    order.source === 'found' ? <>Your recent pace, {amount} a month,</> : <>Your {amount} a month</>
  return <>{whose} goes to the top goal until it&rsquo;s done, then the next.</>
}

export function GoalAmount({ order }: { order: GoalOrder }) {
  const [editing, setEditing] = useState(false)
  if (order.source === 'none') {
    return <AmountForm start={null} canUsePace={false} onDone={() => setEditing(false)} />
  }
  if (editing) {
    return (
      <AmountForm
        start={order.monthlyCents}
        canUsePace={order.source === 'entered'}
        onDone={() => setEditing(false)}
        onCancel={() => setEditing(false)}
      />
    )
  }
  return (
    <p className="small">
      <AmountLine order={order} />{' '}
      <button type="button" className="linkbtn small tap" onClick={() => setEditing(true)}>
        Change
      </button>
    </p>
  )
}
