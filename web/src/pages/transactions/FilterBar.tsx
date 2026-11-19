// The list's filters: a search box, then chips for the date range, the
// category and the account, and "N need a category" while some do. On a
// phone the chips scroll sideways in one line instead of wrapping.

import { useState } from 'react'
import type { Category } from '../../api/client'
import { useAction } from '../../api/hooks'
import { CategoryIcon } from '../../components/design/CategoryIcon'
import { Menu } from '../../components/design/Menu'
import { Sheet } from '../../components/design/Sheet'
import { Icon } from '../../components/ui'
import { useApp } from '../../lib/app'
import { byName } from '../../lib/sort'
import { CategoryPicker } from './CategoryPicker'
import { RANGES } from './filters'
import { UNCATEGORIZED, type ActivityFilters } from './useActivityFilters'

/** The category filter's choice for no filter at all. */
const ALL = 'all'

export function FilterBar({
  filters,
  categories,
}: {
  filters: ActivityFilters
  categories: Category[]
}) {
  return (
    <div className="act-filters">
      <label className="act-search">
        <SearchIcon />
        <input
          type="search"
          className="input"
          placeholder="Search"
          aria-label="Search transactions"
          value={filters.search}
          onChange={(event) => filters.setSearch(event.target.value)}
        />
      </label>
      <div className="fchips" role="group" aria-label="Filters">
        <Menu
          label={`Dates: ${RANGES.find((r) => r.value === filters.range)!.label}`}
          buttonClassName="fchip"
          button={
            <>
              <span>{RANGES.find((r) => r.value === filters.range)!.label}</span>
              <Icon name="down" size={14} />
            </>
          }
          items={RANGES.map((range) => ({
            key: range.value,
            label: range.label,
            checked: filters.range === range.value,
            onSelect: () => filters.setRange(range.value),
          }))}
        />
        <CategoryChip filters={filters} categories={categories} />
        <AccountChip filters={filters} />
        <UncategorizedChip filters={filters} />
      </div>
    </div>
  )
}

/** The category filter: opens an A to Z picker in a sheet. */
function CategoryChip({
  filters,
  categories,
}: {
  filters: ActivityFilters
  categories: Category[]
}) {
  const [open, setOpen] = useState(false)
  const chosen = categories.find((c) => c.id === filters.categoryId)
  const name = filters.categoryId === UNCATEGORIZED ? 'Needs a category' : chosen?.name
  return (
    <>
      <button
        type="button"
        className={name ? 'fchip on' : 'fchip'}
        aria-label={name ? `Category: ${name}` : 'Category: all'}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        {chosen && <CategoryIcon category={chosen} size="sm" />}
        <span>{name ?? 'Category'}</span>
        <Icon name="down" size={14} />
      </button>
      {open && (
        <Sheet title="Filter by category" onClose={() => setOpen(false)}>
          <CategoryPicker
            categories={categories}
            value={filters.categoryId ?? ALL}
            label="Categories"
            extras={[
              { id: ALL, label: 'All categories', icon: <span className="option-spacer" /> },
              {
                id: UNCATEGORIZED,
                label: 'Needs a category',
                icon: <CategoryIcon category={null} size="sm" />,
              },
            ]}
            onPick={(id) => {
              filters.setCategoryId(id === ALL ? null : id)
              setOpen(false)
            }}
          />
        </Sheet>
      )}
    </>
  )
}

/** The account filter: every account A to Z, or all of them. */
function AccountChip({ filters }: { filters: ActivityFilters }) {
  const { settings } = useApp()
  const accounts = byName(useAction('list_accounts').data ?? [], settings.locale)
  const chosen = accounts.find((a) => a.id === filters.accountId)
  const name = filters.accountId ? (chosen?.name ?? 'One account') : null
  return (
    <Menu
      label={`Account: ${name ?? 'all'}`}
      buttonClassName={name ? 'fchip on' : 'fchip'}
      button={
        <>
          <span>{name ?? 'Account'}</span>
          <Icon name="down" size={14} />
        </>
      }
      items={[
        {
          key: ALL,
          label: 'All accounts',
          checked: !filters.accountId,
          onSelect: () => filters.setAccountId(null),
        },
        ...accounts.map((account) => ({
          key: account.id,
          label: account.name,
          checked: account.id === filters.accountId,
          onSelect: () => filters.setAccountId(account.id),
        })),
      ]}
    />
  )
}

/** "N need a category", shown only while some do; tapping it filters to them. */
function UncategorizedChip({ filters }: { filters: ActivityFilters }) {
  const count =
    useAction('list_transactions', { categoryId: UNCATEGORIZED, limit: 1 }).data?.total ?? 0
  const selected = filters.categoryId === UNCATEGORIZED
  if (count === 0 && !selected) return null
  return (
    <button
      type="button"
      className={selected ? 'fchip on' : 'fchip attention'}
      aria-pressed={selected}
      onClick={() => filters.setCategoryId(selected ? null : UNCATEGORIZED)}
    >
      <span>{count} need a category</span>
      {selected && <Icon name="close" size={14} />}
    </button>
  )
}

function SearchIcon() {
  return (
    <svg
      className="act-search-icon"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-4-4" />
    </svg>
  )
}
