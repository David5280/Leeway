// The one seam for money in the Retirement section. Everything here that shows
// an amount from cents goes through Amount or useMoney, so when the shared
// Money component of the design system lands, only this file changes.

import { useApp } from '../../../lib/app'

/** Whole amounts in the owner's currency: "$1,234". */
export function useMoney(): (cents: number) => string {
  return useApp().money
}

/** An amount in the figures' typeface. */
export function Amount({ cents }: { cents: number }) {
  const money = useMoney()
  return <span className="num">{money(cents)}</span>
}
