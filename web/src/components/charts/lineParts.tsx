// Pieces the line charts share: the date axis under the line, the line with
// its soft fill and end point, and a dashed reference level whose words sit on
// whichever side of it the line leaves clear, so the two never collide.

import { useApp } from '../../lib/app'
import { svgNumber, textWidth, type TimeTick, timeTicks } from '../../lib/chartScale'
import { monthYear, shortDate } from '../../lib/format'
import { Money } from '../design/Money'

/** A point of a line, placed in pixels. */
export interface Placed {
  x: number
  y: number
}

/** A time axis label: "Mar 4" for days, "Mar" for months, "Jan 2026" where the year shows. */
export function timeTickLabel(tick: TimeTick, locale: string): string {
  if (!tick.monthly) return shortDate(tick.date, locale)
  if (tick.showYear) return monthYear(tick.date, locale)
  return new Date(`${tick.date}T00:00:00Z`).toLocaleDateString(locale, {
    month: 'short',
    timeZone: 'UTC',
  })
}

/** One date written under the line. */
export interface TimeLabel {
  x: number
  text: string
  anchor: 'start' | 'middle' | 'end'
}

/** Pixels kept clear between two date labels. */
const LABEL_GAP = 10

/**
 * The dates under a line from `first` to `last`. Over months, the line's own
 * first and last months are written at its two ends ("Nov 2025" to "Nov
 * 2026"), so the axis always says where the line starts, and month ticks
 * between them only where they fit. Over days, evenly spaced days.
 */
export function timeLabels(
  first: string,
  last: string,
  x: (date: string) => number,
  left: number,
  right: number,
  locale: string,
): TimeLabel[] {
  const ticks = timeTicks(first, last, Math.floor((right - left) / 80))
  if (!ticks[0]?.monthly) {
    return ticks.map((tick) => ({
      x: x(tick.date),
      text: timeTickLabel(tick, locale),
      anchor: 'middle',
    }))
  }
  const start: TimeLabel = { x: left, text: monthYear(first, locale), anchor: 'start' }
  const end: TimeLabel = { x: right, text: monthYear(last, locale), anchor: 'end' }
  const from = left + textWidth(start.text) + LABEL_GAP
  const to = right - textWidth(end.text) - LABEL_GAP
  const between = ticks
    .map((tick) => ({
      x: x(tick.date),
      text: timeTickLabel(tick, locale),
      anchor: 'middle' as const,
    }))
    .filter(({ x: at, text }) => at - textWidth(text) / 2 >= from && at + textWidth(text) / 2 <= to)
  // A line within one month has a single month to name.
  return start.text === end.text ? [start, ...between] : [start, ...between, end]
}

/** Date labels along the bottom of the plot, for a line through `dates`, oldest first. */
export function TimeAxis({
  dates,
  x,
  left,
  right,
  y,
}: {
  dates: string[]
  x: (date: string) => number
  left: number
  right: number
  y: number
}) {
  const { settings } = useApp()
  if (dates.length < 2) return null
  const labels = timeLabels(dates[0]!, dates.at(-1)!, x, left, right, settings.locale)
  return (
    <g aria-hidden="true">
      {labels.map((label) => (
        <text
          key={`${label.text}-${label.x}`}
          x={label.x}
          y={y}
          textAnchor={label.anchor}
          className="chart-axis"
        >
          {label.text}
        </text>
      ))}
    </g>
  )
}

/** Where the line is, every few pixels from x0 to x1, read off its straight segments. */
export function lineYsAcross(points: Placed[], x0: number, x1: number): number[] {
  const ys: number[] = []
  for (let x = x0; x <= x1; x += 4) {
    const after = points.findIndex((point) => point.x >= x)
    if (after === -1) continue
    const a = points[Math.max(0, after - 1)]!
    const b = points[after]!
    const share = b.x === a.x ? 1 : (x - a.x) / (b.x - a.x)
    ys.push(a.y + (b.y - a.y) * Math.min(1, Math.max(0, share)))
  }
  return ys
}

/** How far the words reach above (or below) their line. */
const ABOVE = { from: -18, to: -2 }
const BELOW = { from: 2, to: 18 }

/**
 * Which side of a level at `at` its words go: above unless the line runs
 * through the words there, then below, then whichever side the line crosses
 * less. A side that would leave the plot (`top` to `bottom`) is never clear.
 */
export function labelSide(
  ys: number[],
  at: number,
  top: number,
  bottom: number,
): 'above' | 'below' {
  const hits = (band: { from: number; to: number }) =>
    ys.filter((y) => y >= at + band.from && y <= at + band.to).length
  const fits = { above: at + ABOVE.from >= top, below: at + BELOW.to <= bottom }
  if (fits.above && hits(ABOVE) === 0) return 'above'
  if (fits.below && hits(BELOW) === 0) return 'below'
  if (!fits.below) return 'above'
  if (!fits.above) return 'below'
  return hits(BELOW) < hits(ABOVE) ? 'below' : 'above'
}

/** A level a line should stay on one side of, such as where net worth started. */
export interface LineReference {
  cents: number
  /** Where the line should be, in words, drawn on the line: "Under 30% of the limit". */
  label: string
  /** Which end its words sit at: the start by default, or the end. */
  at?: 'start' | 'end'
}

/** The reference level as a dashed line, its words and amount beside it, clear of the line. */
export function ReferenceLine({
  reference,
  y,
  left,
  right,
  top,
  bottom,
  line,
}: {
  reference: LineReference | undefined
  y: (cents: number) => number
  left: number
  right: number
  top: number
  bottom: number
  /** The line, placed, so the words can keep clear of it. */
  line: Placed[]
}) {
  const { money } = useApp()
  if (!reference) return null
  const at = y(reference.cents)
  const end = reference.at === 'end'
  const reach = textWidth(`${reference.label}: ${money(reference.cents)}`) + 4
  const [x0, x1] = end ? [right - reach, right] : [left, left + reach]
  const side = labelSide(lineYsAcross(line, x0, x1), at, top, bottom)
  return (
    <g aria-hidden="true">
      <line x1={left} x2={right} y1={at} y2={at} className="chart-line budget" />
      <text
        x={end ? right - 4 : left + 4}
        y={side === 'above' ? at - 6 : at + 15}
        textAnchor={end ? 'end' : 'start'}
        className="chart-axis strong-label"
      >
        {reference.label}: <Money as="tspan" cents={reference.cents} />
      </text>
    </g>
  )
}

/** The line with a soft fill down to the baseline. */
export function ShadedLine({
  points,
  baseline,
  fill,
}: {
  points: { x: number; y: number }[]
  baseline: number
  fill: string
}) {
  if (points.length < 2) return null
  const line = points.map((p) => `${svgNumber(p.x)},${svgNumber(p.y)}`).join(' L')
  return (
    <>
      <path
        d={`M${points[0]!.x},${baseline} L${line} L${points.at(-1)!.x},${baseline} Z`}
        fill={fill}
      />
      <path d={`M${line}`} className="chart-line actual" />
    </>
  )
}

/** The latest point, with its value in the right-hand gutter when there is one. */
export function EndPoint({
  at,
  cents,
  labelX,
}: {
  at: { x: number; y: number }
  /** The amount written beside the point, or null for none. */
  cents: number | null
  labelX: number
}) {
  return (
    <>
      <circle cx={at.x} cy={at.y} r="4" className="chart-dot" />
      {cents !== null && (
        <text x={labelX} y={at.y + 4} className="chart-value ink" aria-hidden="true">
          <Money as="tspan" cents={cents} />
        </text>
      )}
    </>
  )
}
