// Picking the categories that count as essential, the spending an emergency
// fund is sized by: a tick for each spending category, what counts now first
// and the rest under their groups, saved to the essential categories
// setting, or handed back to Leeway to find. A tick on a category with no
// recent spending says it adds nothing, so a quiet pick never surprises, and
// a note names the categories Leeway counts only in part, which no tick shows.

import { useState, type FormEvent } from 'react'
import { useAction, useActionMutation } from '../../../api/hooks'
import { ErrorNote, LoadingOrError } from '../../../components/ui'
import {
  essentialSections,
  quietPicks,
  startingTicks,
  type EssentialSection,
} from '../../../lib/essentialChoice'
import { partlyNote, quietNote, type EmergencyView } from '../../../lib/emergencyText'

/** Whether two lists hold the same ids, in any order. */
function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id) => b.includes(id))
}

/** One heading of the picker and a tick for each category under it. */
function SectionTicks({
  section,
  ticked,
  onToggle,
}: {
  section: EssentialSection
  ticked: string[]
  onToggle: (id: string) => void
}) {
  return (
    <fieldset className="essential-group">
      <legend className="small muted">{section.title}</legend>
      {section.categories.map((category) => (
        <label key={category.id} className="check-row">
          <input
            type="checkbox"
            checked={ticked.includes(category.id)}
            onChange={() => onToggle(category.id)}
          />
          <span className="check-words">{category.name}</span>
        </label>
      ))}
    </fieldset>
  )
}

export function EssentialCategoriesForm({
  view,
  onDone,
}: {
  view: EmergencyView
  onDone: () => void
}) {
  const categories = useAction('list_categories')
  const save = useActionMutation('update_settings')
  const spending = (categories.data ?? []).filter((c) => c.kind === 'expense')
  const start = startingTicks(view, spending)
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
  const quiet = quietNote(quietPicks(spending, shown, view.essentialsChoice.spentIds))
  const partly = partlyNote(view.essentials?.partlyCounted ?? [])
  return (
    <form className="stack-sm" onSubmit={submit} aria-label="Essential categories">
      <span className="small muted">
        Tick what keeps coming due even in a lean month. The fund is sized by these.
      </span>
      {/* Sections follow what counts now, not the live ticks, so rows stay put while ticking. */}
      {essentialSections(spending, start).map((section) => (
        <SectionTicks key={section.title} section={section} ticked={shown} onToggle={toggle} />
      ))}
      {partly && <span className="small muted">{partly}</span>}
      {quiet && <span className="small muted">{quiet}</span>}
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
        <button type="button" className="btn" disabled={save.isPending} onClick={onDone}>
          Cancel
        </button>
        {view.essentialsChoice.pickedIds !== null && (
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
