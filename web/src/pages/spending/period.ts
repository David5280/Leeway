// Which budget period Spending shows. It lives in the address (?period=-1,
// built by paths.spending), so a page a tap deeper can lead back to the same
// period and a reload keeps it. 0 is the current period and earlier ones
// count down from it; the arrows on Spending are the only way to step.

import { useSearchParams } from 'react-router-dom'

/** The furthest back the server reads a period (the offset its actions accept). */
export const OLDEST_PERIOD = -120

/** The period an address's ?period= names, or the current one for anything else. */
export function parsePeriod(value: string | null): number {
  // Whole numbers only: "-1.5", "1e2" or "" fall back to now.
  if (value === null || !/^-\d+$/.test(value)) return 0
  const period = Number(value)
  return period >= OLDEST_PERIOD ? period : 0
}

/** How far back a period is, in words: "This month", "Last month", "3 months ago". */
export function periodDistance(period: number, word: string): string {
  if (period === 0) return `This ${word}`
  if (period === -1) return `Last ${word}`
  return `${-period} ${word}s ago`
}

/**
 * The period in the address and a way to change it. Each step replaces the
 * address, so Back leaves Spending rather than walking back through periods.
 */
export function useSpendingPeriod(): [number, (period: number) => void] {
  const [params, setParams] = useSearchParams()
  const period = parsePeriod(params.get('period'))
  const setPeriod = (next: number) =>
    setParams(next === 0 ? {} : { period: String(next) }, { replace: true })
  return [period, setPeriod]
}
