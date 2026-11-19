// Pure chart math: tidy axis ticks, date ticks, label placement and pointer lookup.
// Kept free of React so every rule here can be read and tested on its own.

import { fromDayNumber, toDayNumber } from './dates'
import { compactMoney, money, type MoneyOptions } from './money'

/** The multiples of a power of ten that read as round numbers on an axis. */
const NICE_STEPS = [1, 2, 2.5, 5, 10]

/** The smallest round number (1, 2, 2.5 or 5 times a power of ten) at or above `value`. */
function niceStep(value: number): number {
  const magnitude = 10 ** Math.floor(Math.log10(value))
  return NICE_STEPS.find((s) => s * magnitude >= value - 1e-9)! * magnitude
}

export interface Ticks {
  /** The axis bounds, widened to whole steps so the outer gridlines carry labels. */
  low: number
  high: number
  values: number[]
}

/**
 * Round tick values covering low..high with at most `maxTicks` gridlines.
 * Zero is always included when the range crosses it, since it anchors the eye.
 */
export function niceTicks(low: number, high: number, maxTicks = 5): Ticks {
  const lo = Math.min(low, high, 0)
  let hi = Math.max(low, high, 0)
  if (hi === lo) hi = lo + 10_000
  // Fewer intervals than ticks: n gridlines bound n - 1 steps.
  const intervals = Math.max(1, maxTicks - 1)
  let step = niceStep((hi - lo) / intervals)
  // Rounding outward can add an interval; widen the step until it fits.
  while (Math.ceil(hi / step - 1e-9) - Math.floor(lo / step + 1e-9) > intervals) {
    step = niceStep(step * 1.01)
  }
  const first = Math.floor(lo / step + 1e-9)
  const last = Math.ceil(hi / step - 1e-9)
  const values: number[] = []
  // Integer steps avoid float drift such as 0.30000000000000004.
  for (let i = first; i <= last; i++) values.push(i * step)
  return { low: first * step, high: last * step, values }
}

/** Amounts from five whole digits up ($10,000) read better shortened on a chart. */
const COMPACT_FROM_CENTS = 1_000_000

/**
 * The label format for a value axis, chosen once for all its ticks so they
 * read alike: whole units ("$750", "$2,500") while the largest amount has four
 * digits or fewer, shortened ("$5K", "$15K") from five on.
 */
export function axisFormat(values: number[], options: MoneyOptions): (cents: number) => string {
  const largest = Math.max(0, ...values.map(Math.abs))
  if (largest < COMPACT_FROM_CENTS) return (cents) => money(cents, options)
  return (cents) => compactMoney(cents, options)
}

/** A rough width of a label in pixels, for layout before the browser has drawn it. */
export function textWidth(text: string, fontSize = 12): number {
  return Math.ceil(text.length * fontSize * 0.6)
}

/**
 * Which of `count` evenly spaced points to label on an axis, at most
 * `maxLabels`: every n-th from the first, so the gaps match (every third day,
 * say), and always the last, dropping the one before it if the two would crowd.
 */
export function axisIndices(count: number, maxLabels: number): number[] {
  if (count <= 0) return []
  const last = count - 1
  if (last === 0) return [0]
  const labels = Math.min(count, Math.max(2, Math.floor(maxLabels)))
  const step = Math.ceil(last / (labels - 1))
  const chosen: number[] = []
  for (let index = 0; index < last; index += step) chosen.push(index)
  // Closer than half a step to the last label reads as a collision.
  if (chosen.length > 1 && last - chosen.at(-1)! < step / 2) chosen.pop()
  chosen.push(last)
  return chosen
}

/**
 * Moves labels apart vertically so none overlap, keeping each as close to its
 * own line as it can and every label inside top..bottom. Takes the wanted y of
 * each label and returns where to draw it, in the same order.
 */
export function spreadLabels(
  wanted: number[],
  minGap: number,
  top: number,
  bottom: number,
): number[] {
  const order = wanted.map((y, index) => ({ y, index })).sort((a, b) => a.y - b.y)
  const placed = order.map((item) => Math.min(bottom, Math.max(top, item.y)))
  // Push down past any label above, then back up past any label below.
  for (let i = 1; i < placed.length; i++) {
    placed[i] = Math.max(placed[i]!, placed[i - 1]! + minGap)
  }
  for (let i = placed.length - 1; i >= 0; i--) {
    const limit = i === placed.length - 1 ? bottom : placed[i + 1]! - minGap
    placed[i] = Math.min(placed[i]!, limit)
  }
  const result: number[] = []
  order.forEach((item, i) => (result[item.index] = placed[i]!))
  return result
}

/** The index of the x position nearest to `x`, or -1 when there are none. */
export function nearestIndex(x: number, positions: number[]): number {
  let best = -1
  let bestDistance = Infinity
  positions.forEach((position, index) => {
    const distance = Math.abs(position - x)
    if (distance < bestDistance) {
      best = index
      bestDistance = distance
    }
  })
  return best
}

export interface TimeTick {
  date: string
  /** Months show the month; the first tick and each January also show the year. */
  showYear: boolean
  monthly: boolean
}

/**
 * Dates to label on a time axis from `first` to `last`. Spans of two months or
 * more get the first of a month, stepping whole months; shorter spans get
 * evenly spaced days. At most `maxTicks` labels.
 */
export function timeTicks(first: string, last: string, maxTicks: number): TimeTick[] {
  const start = toDayNumber(first)
  const span = toDayNumber(last) - start
  const count = Math.max(2, maxTicks)
  if (span < 60) {
    if (span <= 0) return [{ date: first, showYear: false, monthly: false }]
    const step = Math.max(1, Math.ceil(span / (count - 1)))
    const ticks: TimeTick[] = []
    for (let day = 0; day <= span; day += step) {
      ticks.push({ date: fromDayNumber(start + day), showYear: false, monthly: false })
    }
    return ticks
  }
  const [year, month] = first.split('-').map(Number) as [number, number]
  const months = Math.round(span / 30.44)
  // Steps that divide a year, so ticks land on the same months every year;
  // past that, whole years, so a long history still keeps to maxTicks.
  const stepMonths =
    [1, 2, 3, 6].find((s) => months / s <= count - 1) ?? 12 * Math.ceil(months / 12 / (count - 1))
  const ticks: TimeTick[] = []
  // Month starts after the first date, so no label sits left of the line.
  for (let offset = 1; ; offset++) {
    const date = new Date(Date.UTC(year, month - 1 + offset, 1)).toISOString().slice(0, 10)
    if (date > last) break
    // Counting months from year zero lets a two-year step pick every other January.
    const absolute = year * 12 + month - 1 + offset
    const monthOfYear = absolute % 12
    if (absolute % stepMonths !== 0) continue
    ticks.push({ date, showYear: ticks.length === 0 || monthOfYear === 0, monthly: true })
  }
  return ticks
}

/**
 * A coordinate for an SVG path, to a tenth of a pixel: finer is invisible
 * and only makes the path longer.
 */
export function svgNumber(value: number): number {
  return Math.round(value * 10) / 10
}
