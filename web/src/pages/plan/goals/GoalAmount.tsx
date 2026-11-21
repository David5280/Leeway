// The monthly amount that fills goals in order: said in a line with a way to
// change it, or asked for once when Leeway has seen nothing go into goals yet.

import { useState, type FormEvent } from 'react'
import { useActionMutation } from '../../../api/hooks'
import { Money } from '../../../components/design/Money'
import { ErrorNote } from '../../../components/ui'
import { parseMoney } from '../../../lib/format'
import type { GoalOrder } from './orderText'

/** The amount's field and its save button. */
function AmountForm({
  start,
  label,
  onDone,
}: {
  start: number | null
  label: string
  onDone: () => void
}) {
  const save = useActionMutation('update_settings')
  const [text, setText] = useState(start === null ? '' : String(start / 100))
  const cents = parseMoney(text)

  function submit(event: FormEvent) {
    event.preventDefault()
    if (cents === null) return
    save.mutate({ savingsPlan: { goalsMonthlyCents: cents } }, { onSuccess: onDone })
  }

  return (
    <form className="stack-sm" onSubmit={submit} aria-label={label}>
      <span className="small">{label}</span>
      <span className="row wrap">
        <input
          className="input num"
          style={{ width: 130 }}
          inputMode="decimal"
          placeholder="0"
          aria-label="Each month for goals"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <button type="submit" className="btn primary" disabled={cents === null || save.isPending}>
          Save
        </button>
      </span>
      <ErrorNote error={save.error} />
    </form>
  )
}

/** Where the amount came from, finishing "Filling them with $500 a month, ...". */
const SOURCE_WORDS = {
  entered: 'the amount you set.',
  found: 'the pace you have saved at lately.',
} as const

export function GoalAmount({ order }: { order: GoalOrder }) {
  const [editing, setEditing] = useState(false)
  if (order.source === 'none' || editing) {
    return (
      <AmountForm
        start={order.source === 'none' ? null : order.monthlyCents}
        label="How much can you put toward goals each month?"
        onDone={() => setEditing(false)}
      />
    )
  }
  return (
    <p className="small">
      Filling them one at a time with <Money cents={order.monthlyCents} /> a month,{' '}
      {SOURCE_WORDS[order.source]}{' '}
      <button type="button" className="linkbtn small tap" onClick={() => setEditing(true)}>
        Change
      </button>
    </p>
  )
}
