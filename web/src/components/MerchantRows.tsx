// The merchants that took the most, each with its amount and a bar against the
// biggest, so the order reads at a glance: Home's top merchants card and the
// Top merchants page a tap deeper from Spending.

import type { Output } from '../api/client'
import { useApp } from '../lib/app'
import { Money } from './design/Money'
import { Progress } from './ui'

export type Merchants = Output<'top_merchants'>

/** One row a merchant, biggest first as the server lists them; nothing for an empty list. */
export function MerchantRows({ merchants }: { merchants: Merchants }) {
  const { money } = useApp()
  const top = merchants[0]?.spentCents ?? 0
  return merchants.map((one) => (
    <span key={one.merchant} className="stack-sm merchant-row">
      <span className="row-between">
        <span className="ellipsis">{one.merchant}</span>
        <Money cents={one.spentCents} />
      </span>
      <Progress
        percent={top > 0 ? (one.spentCents / top) * 100 : 0}
        aria-label={`${one.merchant}: ${money(one.spentCents)}`}
      />
    </span>
  ))
}
