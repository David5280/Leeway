// Every amount of money Leeway shows is formatted here, and only here.
// Amounts on screen are drawn with <Money> (components/design/Money.tsx),
// which formats through this file; amounts inside a sentence ("$36 left")
// use these functions directly, usually through useApp(). A lint rule
// (eslint/moneyText.js) fails the build when a formatted amount reaches the
// page as text, directly, through a variable or through another name for a
// formatter, so every screen reads money the same way.
//
// The rule reads code without type information, so it cannot follow an
// amount returned from a function, kept in an object or array, passed
// through another function, or assigned to a variable after it was declared.
// Don't build an amount for the page those ways; hand <Money> the cents.
//
// Money is integer cents. Amounts from the bank follow its convention:
// positive is money out, negative is money in.
//
// A rate, like a card's APR, is formatted here too (percentText), so every
// number Leeway writes in the owner's locale comes from this one file.

export interface MoneyOptions {
  currency: string
  locale: string
}

/**
 * Whole units ("$1,235") where cents do not matter, exact ("$1,234.56") where
 * they do, or compact ("$12.5K") where room is short, as on a chart's bars.
 */
export type Precision = 'whole' | 'cents' | 'compact'

/**
 * How an amount's sign reads:
 * - `plain`: as the number is, "-$5" when negative (balances, budgets, totals);
 * - `transaction`: a bank amount, "+$12.00" for money in and "$12.00" for
 *   money out, since ordinary spending needs no mark of its own;
 * - `transfer`: money moved between the owner's own accounts, with no sign,
 *   since it is neither in nor out;
 * - `change`: a difference, always signed: "+$40" or "−$40".
 */
export type MoneySign = 'plain' | 'transaction' | 'transfer' | 'change'

/**
 * What an amount means, which sets its color (styles/tokens.css). Color is
 * never the only signal: money in also carries "+", and a problem is always
 * named in words beside it.
 * - `in`: money coming in (green);
 * - `neutral`: ordinary amounts and spending, in the color of the text around them;
 * - `muted`: quiet amounts, like a transfer between the owner's accounts;
 * - `warn`: close to a limit (amber);
 * - `problem`: something wrong, like overdrawn or over budget (red).
 */
export type MoneyTone = 'in' | 'neutral' | 'muted' | 'warn' | 'problem'

/** The true minus sign, which lines up with "+" in tabular figures; every amount uses it. */
const MINUS = '\u2212'

const formatters = new Map<string, Intl.NumberFormat>()

function formatter(options: MoneyOptions, precision: Precision): Intl.NumberFormat {
  const key = `${options.locale}|${options.currency}|${precision}`
  let found = formatters.get(key)
  if (!found) {
    found = new Intl.NumberFormat(options.locale, {
      style: 'currency',
      currency: options.currency,
      ...DIGITS[precision],
    })
    formatters.set(key, found)
  }
  return found
}

/** How each precision writes its digits. A compact currency would print "$15.0K" by default. */
const DIGITS: Record<Precision, Intl.NumberFormatOptions> = {
  whole: { minimumFractionDigits: 0, maximumFractionDigits: 0 },
  cents: { minimumFractionDigits: 2, maximumFractionDigits: 2 },
  compact: { notation: 'compact', minimumFractionDigits: 0, maximumFractionDigits: 1 },
}

/**
 * An amount in units, rounded to whole units unless cents are wanted. A
 * compact amount under a thousand has nothing to shorten, so it is whole
 * too: "$415", never "$414.7".
 */
function units(cents: number, precision: Precision): number {
  const whole = precision === 'whole' || (precision === 'compact' && Math.abs(cents) < 100_000)
  return whole ? Math.round(cents / 100) : cents / 100
}

/** Text with the locale's hyphen-minus, if any, written as the true minus sign. */
function withMinus(text: string): string {
  return text.replace('-', MINUS)
}

/** An amount as text, with its sign as `sign` says (see MoneySign). */
export function formatMoney(
  cents: number,
  options: MoneyOptions,
  { sign = 'plain', precision = 'whole' }: { sign?: MoneySign; precision?: Precision } = {},
): string {
  const format = formatter(options, precision)
  if (sign === 'plain') return withMinus(format.format(units(cents, precision)))
  const size = format.format(units(Math.abs(cents), precision))
  if (sign === 'transfer') return size
  // A bank amount is negative for money in, which reads "+".
  const incoming = sign === 'transaction' ? cents < 0 : cents > 0
  if (incoming) return `+${size}`
  // Spending needs no mark; a change down does. Zero is neither.
  return sign === 'change' && cents !== 0 ? `${MINUS}${size}` : size
}

/** The tone an amount takes on its own, from what its sign says it is. */
export function toneOf(cents: number, sign: MoneySign): MoneyTone {
  if (sign === 'transfer') return 'muted'
  if (sign === 'transaction' && cents < 0) return 'in'
  return 'neutral'
}

/** "$1,234" (whole units) or "$1,234.56" with exact: true. */
export function money(cents: number, options: MoneyOptions, exact = false): string {
  return formatMoney(cents, options, { precision: exact ? 'cents' : 'whole' })
}

/** A transaction amount: spending as "$12.00", money in as "+$12.00". */
export function signedAmount(cents: number, options: MoneyOptions): string {
  return formatMoney(cents, options, { sign: 'transaction', precision: 'cents' })
}

/**
 * Cents as a person types the amount into a field, to the cent and with no
 * currency or grouping: 384500 is "3845.00", -5 is "-0.05". Worked out in
 * whole cents, so it never rounds the way a float can.
 */
export function typedAmount(cents: number): string {
  const size = Math.abs(Math.round(cents))
  const units = Math.floor(size / 100)
  const hundredths = String(size % 100).padStart(2, '0')
  return `${cents < 0 && size > 0 ? '-' : ''}${units}.${hundredths}`
}

/** Money in the owner's currency, shortened: "$5K", "$12.5K", "$1.2M". */
export function compactMoney(cents: number, options: MoneyOptions): string {
  return formatMoney(cents, options, { precision: 'compact' })
}

/**
 * How a locale writes an amount, for picking one: "$1,234.56" or "1.234,56 $",
 * with the currency's own number of decimals ("¥1,235").
 */
export function currencySample(options: MoneyOptions): string {
  return new Intl.NumberFormat(options.locale, {
    style: 'currency',
    currency: options.currency,
  }).format(1234.56)
}

/** A rate as the locale writes it, to the hundredth: "24.99%", or "24,99 %" in German. */
export function percentText(percent: number, locale: string): string {
  return new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 2 }).format(
    percent / 100,
  )
}
