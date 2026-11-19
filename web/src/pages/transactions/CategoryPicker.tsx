// A list of categories to pick one from, A to Z, each with its icon. With
// many categories a filter box narrows it as the owner types. Used for a
// transaction's category and for the list's category filter.

import { useState, type ReactNode } from 'react'
import type { Category } from '../../api/client'
import { CategoryIcon } from '../../components/design/CategoryIcon'
import { useApp } from '../../lib/app'
import { byName } from '../../lib/sort'

/** Past this many, the picker shows a box to narrow it. */
const FILTER_FROM = 10

/** A choice listed before the categories, like "All categories". */
export interface ExtraChoice {
  id: string
  label: string
  icon: ReactNode
}

export function CategoryPicker({
  categories,
  value,
  label,
  extras = [],
  onPick,
}: {
  categories: Category[]
  /** The chosen category's id, or an extra choice's id. */
  value: string | null
  /** What is being picked, for screen readers: "Category for Blue Bottle". */
  label: string
  extras?: ExtraChoice[]
  onPick: (id: string) => void
}) {
  const { settings } = useApp()
  const [filter, setFilter] = useState('')
  const needle = filter.trim().toLowerCase()
  const shown = byName(categories, settings.locale).filter((category) =>
    category.name.toLowerCase().includes(needle),
  )
  return (
    <div className="picker">
      {categories.length > FILTER_FROM && (
        <input
          className="input"
          type="search"
          placeholder="Find a category"
          aria-label="Find a category"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        />
      )}
      <ul className="options" aria-label={label}>
        {!needle &&
          extras.map((extra) => (
            <Option key={extra.id} on={value === extra.id} onPick={() => onPick(extra.id)}>
              {extra.icon}
              <span className="option-label">{extra.label}</span>
            </Option>
          ))}
        {shown.map((category) => (
          <Option key={category.id} on={value === category.id} onPick={() => onPick(category.id)}>
            <CategoryIcon category={category} size="sm" />
            <span className="option-label">{category.name}</span>
          </Option>
        ))}
      </ul>
      {shown.length === 0 && <p className="empty small">No category matches.</p>}
    </div>
  )
}

function Option({
  on,
  onPick,
  children,
}: {
  on: boolean
  onPick: () => void
  children: ReactNode
}) {
  return (
    <li>
      <button type="button" className="option" aria-pressed={on} onClick={onPick}>
        {children}
        {on && (
          <svg
            className="option-check"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M5 12l4 4 10-10" />
          </svg>
        )}
      </button>
    </li>
  )
}
