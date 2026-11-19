// A transaction as a single read-only line: its category icon, name, date
// and category, and amount. Used where a few recent transactions are listed,
// such as the dashboard and the Accounts dashboard; the Transactions screen
// has its own rows that open a sheet.

import type { Category, Transaction } from '../api/client'
import { useApp } from '../lib/app'
import { shortDate } from '../lib/format'
import { amountSign, isMove, movementTag } from '../lib/transactions'
import { CategoryIcon } from './design/CategoryIcon'
import { Money } from './design/Money'

/** What the line needs of a category: transfers are left out of the lists it is given. */
export type LineCategory = Pick<Category, 'name' | 'color' | 'kind' | 'icon'>

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
  const { settings } = useApp()
  const kind = kindOf(tx, category)
  const about = category?.name ?? movementTag(tx, kind) ?? 'Needs a category'
  return (
    <div className="list-row tx-line">
      <CategoryIcon category={category} transfer={isMove(tx, kind)} size="sm" />
      <span className="grow stack-sm" style={{ gap: 0, minWidth: 0 }}>
        <span className="ellipsis" style={{ fontWeight: 500 }}>
          {tx.displayName}
        </span>
        <span className="small muted ellipsis">
          {shortDate(tx.date, settings.locale)} · {about}
          {tx.pending ? ', pending' : ''}
        </span>
      </span>
      <Money cents={tx.amountCents} sign={amountSign(tx, kind)} size="md" />
    </div>
  )
}
