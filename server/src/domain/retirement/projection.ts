// How retirement savings could grow until a retirement age, as a low, middle
// and high case in today's dollars. Pure.
//
// The math: each month the balance earns the real return (the nominal return
// with inflation taken out) and the monthly contribution is added. Working in
// real terms keeps every figure in today's dollars, and a contribution that
// keeps pace with inflation stays the same number. The low and high cases move
// the return down and up by RETURN_SPREAD points, which is a range of steady
// returns, not a forecast of markets: real returns come in an uneven order.

/** How far the low and high cases move the yearly return, in percentage points. */
export const RETURN_SPREAD = 2

export interface Band {
  low: number
  mid: number
  high: number
}

/** One year on the chart: the age, and the three cases' balances in cents. */
export interface BandPoint extends Band {
  age: number
}

export interface GrowthInput {
  balanceCents: number
  /** Added each month, in today's dollars. */
  monthlyContributionCents: number
  /** Whole years from now to the retirement age; 0 or less means now. */
  years: number
  /** Yearly, before inflation, in percent. */
  returnPercent: number
  inflationPercent: number
}

/** The real yearly return in percent: 6% with 2.5% inflation is about 3.41%. */
export function realReturnPercent(returnPercent: number, inflationPercent: number): number {
  return ((1 + returnPercent / 100) / (1 + inflationPercent / 100) - 1) * 100
}

/** The balance after `months` of growth at a monthly rate, with a deposit each month. */
function grow(balance: number, monthly: number, months: number, rate: number): number {
  // With no growth the annuity formula divides by zero; the sum is plain.
  if (Math.abs(rate) < 1e-12) return balance + monthly * months
  const factor = (1 + rate) ** months
  return balance * factor + (monthly * (factor - 1)) / rate
}

/** The monthly real rate for one case's yearly return. */
function monthlyRate(returnPercent: number, inflationPercent: number): number {
  return (1 + realReturnPercent(returnPercent, inflationPercent) / 100) ** (1 / 12) - 1
}

/** The three yearly returns the cases use. */
export function caseReturns(returnPercent: number): Band {
  return {
    low: returnPercent - RETURN_SPREAD,
    mid: returnPercent,
    high: returnPercent + RETURN_SPREAD,
  }
}

/**
 * The balance in each case at each whole year from now (age `startAge`) to
 * retirement, ending with the balance at retirement. Never below zero: a
 * negative real return shrinks savings but cannot make them owed.
 */
export function growthBand(input: GrowthInput, startAge: number): BandPoint[] {
  const returns = caseReturns(input.returnPercent)
  const years = Math.max(0, input.years)
  const balance = Math.max(0, input.balanceCents)
  const at = (year: number, returnPercent: number) => {
    const rate = monthlyRate(returnPercent, input.inflationPercent)
    return Math.max(0, Math.round(grow(balance, input.monthlyContributionCents, year * 12, rate)))
  }
  return Array.from({ length: years + 1 }, (_, year) => ({
    age: startAge + year,
    low: at(year, returns.low),
    mid: at(year, returns.mid),
    high: at(year, returns.high),
  }))
}

/** Apply `fn` to each case. */
export function mapBand(band: Band, fn: (value: number) => number): Band {
  return { low: fn(band.low), mid: fn(band.mid), high: fn(band.high) }
}
