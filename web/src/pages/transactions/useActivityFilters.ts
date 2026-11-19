// What the transaction list is narrowed to: a search, a date range, a
// category and an account. Category and account live in the address
// (?category=, ?account=) so other screens can link straight to them.

import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { Input } from '../../api/client'
import { useDebounced } from '../../lib/useDebounced'
import { rangeStart, type Range } from './filters'

/** How many transactions load at first, and how many more each "Show more" adds. */
export const PAGE = 100
/** The server returns at most this many at once; past it, search or filter instead. */
export const MAX_SHOWN = 500
/** The category filter's value for transactions that still need a category. */
export const UNCATEGORIZED = 'uncategorized'

/** The filters kept in the address. */
type AddressFilter = 'category' | 'account'

/**
 * Filters kept in the address, replaced in place so Back leaves the screen.
 * One update sets any of them at once, since two quick updates in a row
 * would each start from the same old address.
 */
function useAddressFilters() {
  const [params, setParams] = useSearchParams()
  const set = (changes: Partial<Record<AddressFilter, string | null>>) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current)
        for (const [name, id] of Object.entries(changes)) {
          if (id) next.set(name, id)
          else next.delete(name)
        }
        return next
      },
      { replace: true },
    )
  return { category: params.get('category'), account: params.get('account'), set }
}

export function useActivityFilters({
  periodStart,
  timeZone,
}: {
  /** When the budget period starts, once known; "This period" waits for it. */
  periodStart: string | undefined
  timeZone: string
}) {
  const [search, setSearchText] = useState('')
  const [range, setRangeValue] = useState<Range>('period')
  const address = useAddressFilters()
  const categoryId = address.category
  const accountId = address.account
  const [limit, setLimit] = useState(PAGE)
  const query = useDebounced(search.trim())

  // Any change of filter starts again from the first page.
  const restart =
    <T>(set: (value: T) => void) =>
    (value: T) => {
      set(value)
      setLimit(PAGE)
    }

  const input: Input<'list_transactions'> = {
    search: query || undefined,
    categoryId: categoryId ?? undefined,
    accountId: accountId ?? undefined,
    start: rangeStart(range, periodStart, timeZone),
    // Transactions left out of totals are still listed, marked, so they can be put back.
    includeExcluded: true,
    limit,
  }

  return {
    search,
    range,
    categoryId,
    accountId,
    limit,
    input,
    /** "This period" cannot be asked for until the period's start is known. */
    ready: range !== 'period' || periodStart !== undefined,
    /** Whether anything narrows the list, so an empty list says "Nothing matches". */
    filtered: Boolean(query || categoryId || accountId || range !== 'all'),
    setSearch: restart(setSearchText),
    setRange: restart(setRangeValue),
    setCategoryId: restart((category: string | null) => address.set({ category })),
    setAccountId: restart((account: string | null) => address.set({ account })),
    showMore: () => setLimit((shown) => Math.min(MAX_SHOWN, shown + PAGE)),
    clear: () => {
      setSearchText('')
      setRangeValue('all')
      address.set({ category: null, account: null })
      setLimit(PAGE)
    },
  }
}

export type ActivityFilters = ReturnType<typeof useActivityFilters>
