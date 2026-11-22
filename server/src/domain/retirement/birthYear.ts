// The years a birth year may fall in, counted from the install's today: none
// still to come, and none that would make the owner older than anyone could
// plausibly be. Pure, so the app checks the very same range before it saves.

import type { IsoDate } from '../../lib/dates.js'

/** The oldest age taken; a year further back than this is surely a typo. */
export const OLDEST_AGE = 110

/** The earliest and latest birth years accepted on `today`. */
export function birthYearRange(today: IsoDate): { earliest: number; latest: number } {
  const thisYear = Number(today.slice(0, 4))
  return { earliest: thisYear - OLDEST_AGE, latest: thisYear }
}

/** Why `year` cannot be a birth year on `today`, as a plain sentence, or null when it can. */
export function birthYearProblem(year: number, today: IsoDate): string | null {
  const { earliest, latest } = birthYearRange(today)
  if (year > latest)
    return `Use a birth year of ${latest} or earlier, since ${year} is still to come.`
  if (year < earliest) return `Use a birth year of ${earliest} or later.`
  return null
}
