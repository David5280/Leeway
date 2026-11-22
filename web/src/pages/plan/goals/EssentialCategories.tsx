// Picking the categories that count as essential, the spending an emergency
// fund is sized by: a tick for each spending category, saved to the
// essential categories setting, or handed back to Leeway to find.

import { useState, type FormEvent } from 'react'
import { useAction, useActionMutation } from '../../../api/hooks'
import { ErrorNote, LoadingOrError } from '../../../components/ui'
import type { EmergencyView } from '../../../lib/emergencyText'

type Essentials = NonNullable<EmergencyView['essentials']>

/** Whether two lists hold the same ids, in any order. */
function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id) => b.includes(id))
}

export function EssentialCategoriesForm({
  essentials,
  onDone,
}: {
  essentials: Essentials
  onDone: () => void
}) {
  const categories = useAction('list_categories')
  const save = useActionMutation('update_settings')
  const spending = (categories.data ?? []).filter((c) => c.kind === 'expense')
  // No categories named means all spending counts, so every one starts ticked.
  const start = essentials.categoryIds ?? spending.map((c) => c.id)
  const [ticked, setTicked] = useState<string[] | null>(null)
  // Until the owner ticks something, the form shows what counts now.
  const shown = ticked ?? start

  function toggle(id: string) {
    setTicked(shown.includes(id) ? shown.filter((one) => one !== id) : [...shown, id])
  }

  function pick(essentialCategoryIds: string[] | null) {
    save.mutate({ savingsPlan: { essentialCategoryIds } }, { onSuccess: onDone })
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    // An untouched save changes nothing, so it only closes.
    if (sameIds(shown, start)) onDone()
    else pick(shown)
  }

  if (!categories.data) return <LoadingOrError error={categories.error} />
  return (
    <form className="stack-sm" onSubmit={submit} aria-label="Essential categories">
      <span className="small muted">
        Tick what keeps coming due even in a lean month. The fund is sized by these.
      </span>
      {spending.map((category) => (
        <label key={category.id} className="check-row">
          <input
            type="checkbox"
            checked={shown.includes(category.id)}
            onChange={() => toggle(category.id)}
          />
          <span className="check-words">{category.name}</span>
        </label>
      ))}
      {shown.length === 0 && <span className="small muted">Tick at least one to save.</span>}
      <ErrorNote error={save.error} />
      <div className="row wrap">
        <button
          type="submit"
          className="btn primary"
          disabled={save.isPending || shown.length === 0}
        >
          Save
        </button>
        {essentials.picked && (
          <button
            type="button"
            className="btn"
            disabled={save.isPending}
            onClick={() => pick(null)}
          >
            Let Leeway choose
          </button>
        )}
      </div>
    </form>
  )
}
