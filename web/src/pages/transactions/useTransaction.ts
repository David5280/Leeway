// Reading one transaction again, by the day and account it is listed under.

import type { Transaction } from '../../api/client'
import { useAction } from '../../api/hooks'

/** Enough to find a transaction again. */
export type TransactionRef = Pick<Transaction, 'id' | 'accountId' | 'date'>

/**
 * The newest copy of a transaction, so a sheet shows changes as soon as they
 * are saved, even for one that is not in the list (the other side of a
 * transfer, say). Undefined until it loads, or when it is gone.
 */
export function useTransaction(ref: TransactionRef): Transaction | undefined {
  const day = useAction('list_transactions', {
    accountId: ref.accountId,
    start: ref.date,
    end: ref.date,
    includeExcluded: true,
  })
  return day.data?.transactions.find((tx) => tx.id === ref.id)
}
