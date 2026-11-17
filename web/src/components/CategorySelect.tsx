// A dropdown of categories, used wherever something gets filed.

import type { Category } from '../api/client'

/** Picks a category. With emptyLabel, choosing nothing is allowed and shown with that text. */
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
      {categories.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
    </select>
  )
}
