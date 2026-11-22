// What the transaction list is narrowed to: a search, a date range, a
// category, an account and a merchant. All but the search live in the
// address (?range=, ?category=, ?account=, ?merchant=), so other screens can
// link straight to them and a reload or Back keeps them. A leak alert links
// to one merchant's charges that way: ?merchant= is one of its charges, and
// ?merchantName= the name its chip shows.

import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { Input } from '../../api/client'
import { useDebounced } from '../../lib/useDebounced'
import { parseRange, rangeParam, rangeStart, type Range } from './filters'

/** How many transactions load at first, and how many more each "Show more" adds. */
export const PAGE = 100
/** The server returns at most this many at once; past it, search or filter instead. */
export const MAX_SHOWN = 500
/** The category filter's value for transactions that still need a category. */
export const UNCATEGORIZED = 'uncategorized'

/** The filters kept in the address, and the merchant's name for its chip. */
type AddressFilter = 'category' | 'account' | 'range' | 'merchant' | 'merchantName'

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
  return {
    category: params.get('category'),
    account: params.get('account'),
    range: parseRange(params.get('range')),
    merchant: params.get('merchant'),
    merchantName: params.get('merchantName'),
    set,
  }
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
  const address = useAddressFilters()
  const range = address.range
  const categoryId = address.category
  const accountId = address.account
  const merchantId = address.merchant
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
    sameMerchantAs: merchantId ?? undefined,
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
    /** The merchant the list is narrowed to, by one of its charges, and the name it shows as. */
    merchant: merchantId ? { id: merchantId, name: address.merchantName } : null,
    limit,
    input,
    /** "This period" cannot be asked for until the period's start is known. */
    ready: range !== 'period' || periodStart !== undefined,
    /** Whether anything narrows the list, so an empty list says "Nothing matches". */
    filtered: Boolean(query || categoryId || accountId || merchantId || range !== 'all'),
    setSearch: restart(setSearchText),
    setRange: restart((value: Range) => address.set({ range: rangeParam(value) })),
    setCategoryId: restart((category: string | null) => address.set({ category })),
    setAccountId: restart((account: string | null) => address.set({ account })),
    clearMerchant: restart<void>(() => address.set({ merchant: null, merchantName: null })),
    showMore: () => setLimit((shown) => Math.min(MAX_SHOWN, shown + PAGE)),
    clear: () => {
      setSearchText('')
      address.set({
        category: null,
        account: null,
        merchant: null,
        merchantName: null,
        range: rangeParam('all'),
      })
      setLimit(PAGE)
    },
  }
}

export type ActivityFilters = ReturnType<typeof useActivityFilters>
