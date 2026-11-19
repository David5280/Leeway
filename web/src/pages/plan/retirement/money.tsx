// The one seam for money in the Retirement section. Everything here that shows
// an amount from cents goes through Amount or useMoney, so when the shared
// Money component of the design system lands, only this file changes.

import { useApp } from '../../../lib/app'

/** Whole amounts in the owner's currency: "$1,234". */
export function useMoney(): (cents: number) => string {
  return useApp().money
}

/** Exact amounts to the cent, as a paystub prints them: "$1,234.56". */
export function useExactMoney(): (cents: number) => string {
  return useApp().exact
}

/** An amount in the figures' typeface: whole, or to the cent when `exact`. */
export function Amount({ cents, exact = false }: { cents: number; exact?: boolean }) {
  const whole = useMoney()
  const toTheCent = useExactMoney()
  return <span className="num">{(exact ? toTheCent : whole)(cents)}</span>
}
