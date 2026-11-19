// The drill-down for a short list of recent transactions: what went out,
// what came in, and each one. Transfers between the owner's accounts and
// excluded transactions count toward neither, as everywhere else. Pure.

import type { Category, Transaction } from '../../api/client'
import type { DrillDown } from '../drill'
import { amountSign, isMove } from '../transactions'

type Kind = Category['kind'] | null

/** Money out and money in across transactions, leaving out moves and excluded ones. */
export function inAndOut(
  transactions: readonly Pick<Transaction, 'amountCents' | 'excluded' | 'categoryId'>[],
  kindOf: (categoryId: string | null) => Kind,
): { outCents: number; inCents: number } {
  let outCents = 0
  let inCents = 0
  for (const tx of transactions) {
    if (tx.excluded || isMove(kindOf(tx.categoryId))) continue
    // Bank amounts are positive for money out, negative for money in.
    if (tx.amountCents > 0) outCents += tx.amountCents
    else inCents -= tx.amountCents
  }
  return { outCents, inCents }
}

/** The newest few transactions, added up, each opening Activity. */
export function recentDrill(
  transactions: readonly Transaction[],
  categories: ReadonlyMap<string, Pick<Category, 'name' | 'color' | 'icon' | 'kind'>>,
): DrillDown {
  const kindOf = (id: string | null): Kind => (id ? (categories.get(id)?.kind ?? null) : null)
  const { outCents, inCents } = inAndOut(transactions, kindOf)
  const count = transactions.length
  return {
    title: 'Recent transactions',
    figure: { text: `${count} ${count === 1 ? 'transaction' : 'transactions'}` },
    math: {
      terms: [
        { label: 'Money out', value: { cents: outCents } },
        { label: 'money in', value: { cents: inCents, sign: 'change', tone: 'in' }, op: 'minus' },
      ],
      result: { label: 'Out, after what came in', value: { cents: outCents - inCents } },
      note: 'Transfers between your own accounts count as neither.',
    },
    items: {
      title: 'Transactions',
      rows: transactions.map((tx) => {
        const kind = kindOf(tx.categoryId)
        return {
          key: tx.id,
          label: tx.displayName,
          detail: tx.accountName,
          value: { cents: tx.amountCents, sign: amountSign(kind) },
          to: '/transactions',
          icon: {
            category: tx.categoryId ? (categories.get(tx.categoryId) ?? null) : null,
            transfer: isMove(kind),
          },
        }
      }),
    },
    more: { to: '/transactions', label: 'See all transactions' },
  }
}
