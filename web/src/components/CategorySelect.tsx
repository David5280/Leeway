// A dropdown of categories, used wherever something gets filed or filtered.
// Categories read A to Z under their group headings, whatever order the
// budget keeps them in, so a name is quick to find in a long list.

import type { Category } from '../api/client'
import { alphabeticalGroups, compareNames, type CategoryGroup } from '../lib/alphabetical'
import { useApp } from '../lib/app'

/** The heading for categories without a group, when others have one (as on Budgets). */
export const UNGROUPED_LABEL = 'No group'

/**
 * The picker's headings: groups A to Z, then the categories with no group
 * under UNGROUPED_LABEL. Should someone have named a group "No group" too,
 * the two would read as one heading, so they become one: last, under the
 * name as they wrote it, its categories A to Z.
 */
export function pickerGroups(
  categories: Category[],
  locale: string,
): { label: string | null; categories: Category[] }[] {
  const groups = alphabeticalGroups(categories, locale)
  const ungrouped = groups.find((g) => g.group === null)
  const sameName = groups.find(
    (g) => g.group !== null && compareNames(g.group, UNGROUPED_LABEL, locale) === 0,
  )
  const label = (g: CategoryGroup<Category>) => ({ label: g.group, categories: g.categories })
  if (!ungrouped || !sameName) return groups.map(label)
  const merged = alphabeticalGroups(
    [...sameName.categories, ...ungrouped.categories].map((c) => ({ ...c, group: null })),
    locale,
  )[0]!.categories
  return [
    ...groups.filter((g) => g !== ungrouped && g !== sameName).map(label),
    { label: sameName.group, categories: merged },
  ]
}

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
  const { settings } = useApp()
  const groups = pickerGroups(categories, settings.locale)
  // Headings only help when some category has a group; otherwise one plain list.
  const headed = groups.some((g) => g.label !== null)
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
        ? groups.map(({ label: heading, categories: members }) => (
            <optgroup key={heading ?? ''} label={heading ?? UNGROUPED_LABEL}>
              {optionsFor(members)}
            </optgroup>
          ))
        : optionsFor(groups.flatMap((g) => g.categories))}
    </select>
  )
}
