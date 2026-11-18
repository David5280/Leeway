// A transaction as a single read-only line: date, title, category and amount.
// Used where a few recent transactions are listed, such as the dashboard and
// the Accounts dashboard; the Transactions screen has its own editable row.

import type { Category, Transaction } from '../api/client'
import { useApp } from '../lib/app'
import { shortDate } from '../lib/format'
import { amountClass, amountTone, movementTag, transactionTitle } from '../lib/transactions'
import { Dot } from './ui'

/** What the line needs of a category: transfers are left out of the lists it is given. */
export type LineCategory = Pick<Category, 'name' | 'color' | 'kind'>

/**
 * The kind of a transaction's category. The categories given leave out
 * transfers, so a category id they do not know is a transfer.
 */
function kindOf(tx: Transaction, category: LineCategory | undefined) {
  if (category) return category.kind
  return tx.categoryId ? 'transfer' : null
}

export function TransactionLine({
  tx,
  category,
}: {
  tx: Transaction
  category: LineCategory | undefined
}) {
  const { signed, settings } = useApp()
  const kind = kindOf(tx, category)
  return (
    <div className="list-row">
      <span className="num small muted" style={{ width: 56, flex: 'none' }}>
        {shortDate(tx.date, settings.locale)}
      </span>
      <span className="grow stack-sm" style={{ gap: 0 }}>
        <span className="ellipsis" style={{ fontWeight: 500 }}>
          {transactionTitle(tx)}
        </span>
        <span className="small muted row" style={{ gap: 6 }}>
          <Dot color={category?.color} dashed={!tx.categoryId} />
          {category?.name ?? movementTag(tx, kind) ?? 'Needs a category'}
          {tx.pending ? ', pending' : ''}
        </span>
      </span>
      <span className={amountClass(amountTone(tx, kind))} style={{ fontWeight: 500 }}>
        {signed(tx.amountCents)}
      </span>
    </div>
  )
}
