// A category's budget amount that turns into a box when clicked: type a new
// amount and press Enter (or click away) to save, Escape to leave it as it
// was. Clearing the box removes the budget, so the category is only tracked.

import { useState, type FormEvent, type KeyboardEvent } from 'react'
import type { Category } from '../../api/client'
import { useActionMutation } from '../../api/hooks'
import { CADENCE_LABELS } from '../../components/CategoryForm'
import { Money } from '../../components/design/Money'
import { ErrorNote } from '../../components/ui'
import { UnreadableAmount } from '../../components/UnreadableAmount'
import { parseMoney } from '../../lib/format'

/** The amount to save from what was typed: cents, null for a blank box, undefined if unreadable. */
function typedBudget(text: string): number | null | undefined {
  if (text.trim() === '') return null
  const cents = parseMoney(text)
  return cents !== null && cents >= 0 ? cents : undefined
}

export function InlineBudget({
  category,
  shown,
}: {
  /** The category as stored: its own amount and cadence, before any rollover. */
  category: Category
  /** The budget the row shows for this period, in cents, or null for none. */
  shown: number | null
}) {
  const [text, setText] = useState<string | null>(null)
  const update = useActionMutation('update_category')
  const editing = text !== null
  const typed = typedBudget(text ?? '')

  function save(event?: FormEvent) {
    event?.preventDefault()
    if (typed === undefined) return
    if (typed === category.budgetCents) return setText(null)
    update.mutate({ id: category.id, budgetCents: typed }, { onSuccess: () => setText(null) })
  }

  function onKey(event: KeyboardEvent) {
    if (event.key !== 'Escape') return
    update.reset()
    setText(null)
  }

  if (!editing) {
    return (
      <button
        type="button"
        className="linkbtn num inline-budget"
        aria-label={
          shown !== null ? `Change ${category.name} budget` : `Set ${category.name} budget`
        }
        onClick={() =>
          setText(category.budgetCents === null ? '' : String(category.budgetCents / 100))
        }
      >
        {shown === null ? 'Set budget' : <Money cents={shown} />}
      </button>
    )
  }

  return (
    <form className="inline-budget-form" onSubmit={save} aria-label={`${category.name} budget`}>
      <input
        className="input num"
        inputMode="decimal"
        // Opened by a click on the amount, so typing can start right away.
        autoFocus
        aria-label={`${category.name} budget amount`}
        aria-invalid={typed === undefined}
        placeholder="None"
        value={text}
        disabled={update.isPending}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKey}
        onBlur={() => save()}
      />
      <span className="small muted">{CADENCE_LABELS[category.budgetCadence]}</span>
      <UnreadableAmount text={text} />
      <ErrorNote error={update.error} />
    </form>
  )
}
