// Spending so far set against the same point in the last period, in words:
// "$40 more than this point last month". Shared by the home screen's Spent
// card and the main number on Transactions, so both say it the same way.

import type { Budget } from '../api/client'
import { Money } from './design/Money'

export function SpentComparison({
  totals,
  previous,
  word,
}: {
  totals: Budget['totals']
  previous: Budget['previous']
  /** The period's everyday word: "month", "week" or "paycheck". */
  word: string
}) {
  const diff = totals.spentCents - previous.spentToDateCents
  if (previous.spentToDateCents === 0 && diff === 0) return <>Nothing yet</>
  return (
    <>
      <Money cents={Math.abs(diff)} /> {diff >= 0 ? 'more' : 'less'} than this point last {word}
    </>
  )
}
