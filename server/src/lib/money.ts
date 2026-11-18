// Money as integer cents: converting bank amounts and formatting for agents.

/**
 * Converts a decimal amount from a bank API (e.g. 12.34) to integer cents.
 * Math.round fixes float artifacts like 0.1 + 0.2 = 0.30000000000000004.
 */
export function toCents(amount: number): number {
  return Math.round(amount * 100)
}

export function toCentsOrNull(amount: number | null | undefined): number | null {
  return amount === null || amount === undefined ? null : toCents(amount)
}

/** "$1,234.56" style formatting for agent-facing text. Whole dollars drop the cents. */
export function formatCents(cents: number, currency = 'USD', locale = 'en-US'): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: Number.isInteger(cents / 100) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(cents / 100)
}
