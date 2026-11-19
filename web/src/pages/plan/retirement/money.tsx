// The one seam for money in the Retirement section. Every amount drawn here
// goes through Amount, which draws the shared <Money> component, so amounts
// look, round and color as they do on every other screen. useMoney and
// useExactMoney are for amounts inside a sentence a screen reader reads, like
// a chart's description, where no element can go.

import { Money } from '../../../components/design/Money'
import { useApp } from '../../../lib/app'

/** Whole amounts in the owner's currency, as text: "$1,234". */
export function useMoney(): (cents: number) => string {
  return useApp().money
}

/** Exact amounts to the cent, as text, as a paystub prints them: "$1,234.56". */
export function useExactMoney(): (cents: number) => string {
  return useApp().exact
}

/**
 * Which way an amount moves, for its color and sign (see MoneyTone):
 * - `in`: money that comes to the owner, like pay or a pension's income,
 *   drawn green with a "+";
 * - `out`: money that leaves the owner's pay, like a contribution, drawn
 *   plain as spending is;
 * - left out, an amount that only stands, like a balance.
 */
export type Flow = 'in' | 'out'

/** An amount, whole or to the cent when `exact`, colored by which way it moves. */
export function Amount({
  cents,
  exact = false,
  flow,
}: {
  cents: number
  exact?: boolean
  flow?: Flow
}) {
  const precision = exact ? 'cents' : 'whole'
  if (flow === 'in') return <Money cents={cents} sign="change" tone="in" precision={precision} />
  return <Money cents={cents} precision={precision} />
}
