// Turning what a paystub prints into numbers. The reader copies each figure
// exactly as printed, so the model never does arithmetic; the parsing and
// any adding up happen here, where they are tested. Pure.

/** One number as printed: "1,234.56", "1234.5", "$275" or "31.2500", with no sign. */
const NUMBER = /^\$?\s?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?$/

/** Parentheses around an amount, with or without a dollar sign before them: "(12.50)", "$(12.50)". */
const PARENTHESES = /^\$?\((.*)\)$/

/** One minus sign, before or after an amount: "-12.50", "12.50-". */
const MINUS = /^-|-$/

/**
 * A single number as printed, or null when it is not one or has more decimal
 * places than allowed. "(12.50)", "$(12.50)", "-12.50" and "12.50-" read as
 * positive, since a deduction's sign usually only says which column it is
 * in. A sign that says more, a refund or a reversal, is caught in signs.ts.
 */
function plainNumber(printed: string, maxDecimals: number): number | null {
  // Each mark is taken off once, so "-12.50-" is no number.
  const plain = printed.trim().replace(PARENTHESES, '$1').replace(MINUS, '')
  const match = NUMBER.exec(plain)
  if (!match || (match[1]?.length ?? 0) > maxDecimals) return null
  return Number(plain.replace(/[$,\s]/g, ''))
}

/**
 * Every part of a figure as printed, added up, or null when any part is not
 * a number. Two lines of the same kind come joined with " + ".
 */
function total(printed: string, maxDecimals: number): number | null {
  let sum = 0
  for (const part of printed.split('+')) {
    const value = plainNumber(part, maxDecimals)
    if (value === null) return null
    sum += value
  }
  return sum
}

/** An amount as printed, in cents, or null when it is not one: "3,845.00" is 384500. */
export function centsOf(printed: string): number | null {
  const dollars = total(printed, 2)
  return dollars === null ? null : Math.round(dollars * 100)
}

/**
 * An hourly rate as printed, in cents. Rates are often printed to four
 * places, like 31.2500 or 28.3750, so they are read that far and rounded to
 * the cent.
 */
export function rateCentsOf(printed: string): number | null {
  const dollars = total(printed, 4)
  return dollars === null ? null : Math.round(dollars * 100)
}

/** Hours as printed, to the hundredth: "86.67" is 86.67, "80" is 80. */
export function hoursOf(printed: string): number | null {
  const hours = total(printed, 4)
  return hours === null ? null : Math.round(hours * 100) / 100
}

/** How an amount is marked: plain, every part negative, or parts that differ. */
export type Sign = 'plus' | 'minus' | 'mixed'

/** Whether one part of an amount carries a negative mark: a minus before or after it, or parentheses. */
function negative(part: string): boolean {
  const plain = part.trim()
  return PARENTHESES.test(plain) || MINUS.test(plain)
}

/** How an amount as printed is marked; null when it is not printed, blank or zero, which carry no sign. */
export function signOf(printed: string | null): Sign | null {
  if (printed === null || !/[1-9]/.test(printed)) return null
  const marks = printed.split('+').map(negative)
  if (marks.every(Boolean)) return 'minus'
  return marks.some(Boolean) ? 'mixed' : 'plus'
}
