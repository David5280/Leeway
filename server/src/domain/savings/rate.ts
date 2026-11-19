// The savings rate: the share of pay that goes to savings, from every source
// Leeway can see. Pure. Sources are listed one by one so the owner (and an
// assistant) can see exactly what was counted and what was not.
//
// Payroll deductions (a pension, a 401(k)) leave pay before it reaches the
// bank, so a rate built from bank transfers alone can read low. A pension's
// contributions count once the owner enters them (retirement/pensions.ts);
// nothing else taken from pay ever does. Every place that shows the rate says
// which, with countedNote. There is no target until the owner sets one, and no
// progress bar toward it, so a partial rate never reads as falling short.

/** Said to the owner beside a savings rate built from bank transfers alone. */
export const SEEN_AT_BANK = 'Payroll deductions, such as a pension or a 401(k), are not counted.'

/** Said to the owner beside a savings rate that counts the pension contributions they entered. */
export const PENSION_COUNTED =
  'Pension contributions you entered are counted; other payroll deductions, such as a 401(k), are not.'

/**
 * Said to an assistant wherever it reads the rate, so the guard travels with
 * the number: a rate that misses payroll deductions is never grounds to say
 * the owner saves too little, and a pension is retirement saving in its own
 * right, whatever goes into a 401(k), IRA or brokerage account.
 */
export const RATE_GUARD_FOR_AI =
  'Payroll deductions are counted only where the owner entered them, as for a pension, so never say this rate is too little. A pension is retirement saving: never say someone with one under-saves for retirement because little or nothing goes into a 401(k), IRA or brokerage account.'

/** One stream of saving that counts toward the rate. */
export interface SavingSource {
  /** Plain words for what it is, like "Transfers to savings". */
  label: string
  monthlyCents: number
  /**
   * Taken from pay before it reaches the bank (a pension contribution), so
   * it is added back to take-home pay to get the pay it came out of.
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

/** Whether a rate counts anything taken from pay before the bank sees it. */
export function countsPayroll(rate: SavingsRate): boolean {
  return rate.sources.some((source) => source.beforePaycheck)
}

/**
 * What the rate is a share of: take-home pay, or pay before the pension
 * contribution once one is counted, since that is added back.
 */
export function payNoun(rate: SavingsRate): string {
  return countsPayroll(rate) ? 'pay' : 'take-home pay'
}

/** What the owner is told was counted in a rate, said beside it everywhere. */
export function countedNote(rate: SavingsRate): string {
  return countsPayroll(rate) ? PENSION_COUNTED : SEEN_AT_BANK
}

/**
 * The same rate counting only what moved through the bank, as if no pension
 * contribution were entered: what the check-in reports as bank-seen, beside
 * the full rate. Null when nothing moved through the bank.
 */
export function bankSeenRate(rate: SavingsRate | null): SavingsRate | null {
  if (rate === null) return null
  const withheld = rate.sources
    .filter((source) => source.beforePaycheck)
    .reduce((sum, source) => sum + source.monthlyCents, 0)
  return savingsRate(
    rate.payMonthlyCents - withheld,
    rate.sources.filter((source) => !source.beforePaycheck),
  )
}
