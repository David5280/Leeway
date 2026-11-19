// A dropdown of categories, used wherever something gets filed or filtered.
// Categories read A to Z under their group headings, whatever order the
// budget keeps them in, so a name is quick to find in a long list.

import type { Category } from '../api/client'
import { alphabeticalGroups } from '../lib/alphabetical'

/** The heading for categories without a group, when others have one (as on Budgets). */
export const UNGROUPED_LABEL = 'Other'

const optionsFor = (categories: Category[]) =>
  categories.map((c) => (
    <option key={c.id} value={c.id}>
      {c.name}
    </option>
  ))

/**
 * Picks a category. With emptyLabel, choosing nothing is allowed and shown
 * with that text, always first (like "All categories" or "Uncategorized").
 */
export function CategorySelect({
  categories,
  value,
  onChange,
  label,
  emptyLabel,
  disabled,
}: {
  categories: Category[]
  value: string | null
  onChange: (id: string | null) => void
  label: string
  emptyLabel?: string
  disabled?: boolean
}) {
  const groups = alphabeticalGroups(categories)
  // Headings only help when some category has a group; otherwise one plain list.
  const headed = groups.some((g) => g.group !== null)
  return (
    <select
      className="input"
      aria-label={label}
      value={value ?? ''}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value || null)}
    >
      {emptyLabel !== undefined && <option value="">{emptyLabel}</option>}
      {emptyLabel === undefined && value === null && (
        <option value="" disabled>
          Pick a category
        </option>
      )}
      {headed
        ? groups.map(({ group, categories: members }) => (
            <optgroup key={group ?? ''} label={group ?? UNGROUPED_LABEL}>
              {optionsFor(members)}
            </optgroup>
          ))
        : optionsFor(groups.flatMap((g) => g.categories))}
    </select>
  )
}
