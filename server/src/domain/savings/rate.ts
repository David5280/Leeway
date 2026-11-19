// The savings rate: the share of pay that goes to savings, from every source
// Leeway can see. Pure. Sources are listed one by one so the owner (and an
// assistant) can see exactly what was counted and what was not.

/** The common rule of thumb (save a fifth of pay), until the owner sets their own. */
export const DEFAULT_SAVINGS_RATE_TARGET = 20

/** One stream of saving that counts toward the rate. */
export interface SavingSource {
  /** Plain words for what it is, like "Transfers to savings". */
  label: string
  monthlyCents: number
  /**
   * Taken from pay before it reaches the bank (a pension or 401k deduction),
   * so it is added back to take-home pay to get the pay it came out of.
   */
  beforePaycheck: boolean
}

export interface SavingsRate {
  /** Whole percent of pay saved. */
  percent: number
  savedMonthlyCents: number
  /** Take-home pay plus anything saved before the paycheck. */
  payMonthlyCents: number
  sources: SavingSource[]
}

/**
 * The share of pay saved. Take-home income comes from the bank, which never
 * sees what payroll keeps back, so savings taken before the paycheck are
 * added to both sides: saved, and the pay they came out of. Null when pay is
 * unknown, or when no source of saving was found at all; a rate of zero
 * would claim the owner saves nothing, which Leeway cannot know.
 */
export function savingsRate(
  takeHomeMonthlyCents: number | null,
  sources: SavingSource[],
): SavingsRate | null {
  const counted = sources.filter((source) => source.monthlyCents > 0)
  if (takeHomeMonthlyCents === null || takeHomeMonthlyCents <= 0 || counted.length === 0) {
    return null
  }
  const savedMonthlyCents = counted.reduce((sum, source) => sum + source.monthlyCents, 0)
  const withheld = counted
    .filter((source) => source.beforePaycheck)
    .reduce((sum, source) => sum + source.monthlyCents, 0)
  const payMonthlyCents = takeHomeMonthlyCents + withheld
  return {
    percent: Math.round((savedMonthlyCents / payMonthlyCents) * 100),
    savedMonthlyCents,
    payMonthlyCents,
    sources: counted,
  }
}
