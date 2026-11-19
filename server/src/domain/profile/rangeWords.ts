// A range of cases in words, shared by every retirement sentence, so a range
// whose ends agree (savings an owner past retirement age holds today, or a
// pension whose figure is fixed) always reads as one figure. Pure.

import type { Band } from '../retirement/projection.js'

/** A whole percent as written: 81%. */
export const percent = (value: number): string => `${value}%`

/** "$1,200 to $1,800", or one figure when the cases agree: "$72,000". */
export function range(band: Band, show: (value: number) => string): string {
  return band.low === band.high ? show(band.mid) : `${show(band.low)} to ${show(band.high)}`
}

/**
 * The middle case of a range, shown, or null when the range is one figure
 * already and saying it twice would read oddly.
 */
export function middleFigure(band: Band, show: (value: number) => string): string | null {
  return band.low === band.high ? null : show(band.mid)
}

/** The middle case after a range, like ", most likely 81%", or nothing when the ends agree. */
export function middleCase(
  band: Band,
  show: (value: number) => string,
  words = 'most likely',
): string {
  const middle = middleFigure(band, show)
  return middle === null ? '' : `, ${words} ${middle}`
}
