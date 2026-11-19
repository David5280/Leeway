// <Money>: the one way an amount is drawn. Every screen shows money through
// it, so amounts share their figures, signs, rounding and colors:
// - tabular figures in the theme's number font, so columns line up;
// - a sign that says what the amount is (see MoneySign in lib/money.ts):
//   "+" for money in, none for ordinary spending or a transfer;
// - a tone that colors it by meaning (see MoneyTone), never by color alone;
// - whole units unless cents matter (`precision`);
// - a size from the type scale, `xl` for a card's one key figure.
// Pass `onOpen` to make the amount a button, for a breakdown of what makes it up.

import type { CSSProperties } from 'react'
import { useApp } from '../../lib/app'
import {
  formatMoney,
  toneOf,
  type MoneySign,
  type MoneyTone,
  type Precision,
} from '../../lib/money'

export type MoneySize = 'sm' | 'md' | 'lg' | 'xl'

export interface MoneyProps {
  cents: number
  /** How the sign reads; `transaction` for a bank amount, where negative is money in. */
  sign?: MoneySign
  /** What the amount means, for its color; by default worked out from `sign`. */
  tone?: MoneyTone
  /** Whole units by default; `cents` where they matter, as on a transaction. */
  precision?: Precision
  /** Inherits the text around it unless given. */
  size?: MoneySize
  /** `tspan` to draw the amount inside an SVG <text>, as a chart does. */
  as?: 'span' | 'tspan'
  /** Makes the amount a button that opens its breakdown. */
  onOpen?: () => void
  /** What the button says to a screen reader, like "Spent this period, show breakdown". */
  openLabel?: string
  className?: string
  style?: CSSProperties
}

/** The classes that carry an amount's look; shared with anything drawn like money. */
export function moneyClass(tone: MoneyTone, size?: MoneySize, extra = ''): string {
  return ['money', `money-${tone}`, size ? `money-${size}` : '', extra].filter(Boolean).join(' ')
}

export function Money({
  cents,
  sign = 'plain',
  tone,
  precision,
  size,
  as = 'span',
  onOpen,
  openLabel,
  className = '',
  style,
}: MoneyProps) {
  const { settings } = useApp()
  const options = { currency: settings.currency, locale: settings.locale }
  // A bank transaction is shown to the cent; other amounts round unless told not to.
  const digits = precision ?? (sign === 'transaction' || sign === 'transfer' ? 'cents' : 'whole')
  const text = formatMoney(cents, options, { sign, precision: digits })
  const classes = moneyClass(tone ?? toneOf(cents, sign), size, className)
  if (as === 'tspan') {
    return (
      <tspan className={classes} style={style}>
        {text}
      </tspan>
    )
  }
  if (onOpen) {
    return (
      <button
        type="button"
        className={`${classes} money-open`}
        style={style}
        aria-label={openLabel ? `${text}, ${openLabel}` : undefined}
        onClick={onOpen}
      >
        {text}
      </button>
    )
  }
  return (
    <span className={classes} style={style}>
      {text}
    </span>
  )
}
