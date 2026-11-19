// The savings rate: the share of pay that goes to savings, from every source
// Leeway can see. Pure. Sources are listed one by one so the owner (and an
// assistant) can see exactly what was counted and what was not.
//
// Payroll deductions (a pension, a 401(k)) leave pay before it reaches the
// bank, so a rate built from bank transfers alone can read low. Every place
// that shows the rate says so, with SEEN_AT_BANK. There is no target until the
// owner sets one, and no progress bar toward it, so a partial rate never
// reads as falling short.

/** Said to the owner beside every savings rate built from bank transfers alone. */
export const SEEN_AT_BANK = 'Payroll deductions, such as a pension or a 401(k), are not counted.'

/**
 * Said to an assistant wherever it reads the rate, so the guard travels with
 * the number: a rate the bank only partly sees is never grounds to say the
 * owner saves too little.
 */
export const RATE_GUARD_FOR_AI =
  'Payroll deductions, such as a pension or a 401(k), are not counted, so never say this rate is too little.'

/** One stream of saving that counts toward the rate. */
export interface SavingSource {
  /** Plain words for what it is, like "Transfers to savings". */
  label: string
  monthlyCents: number
  /**
   * Taken from pay before it reaches the bank (a pension or 401k deduction),
   * so it is added back to take-home pay to get the pay it came out of. No
   * source sets it yet: the pension and retirement plan work will feed it.
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
