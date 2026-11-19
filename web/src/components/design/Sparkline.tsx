// A small line of how a number moved, for where the trend matters more than
// the values: a card's corner, a row's end, a drill-down's trend. With
// `area` it fills softly under the line and marks where it ends today.
// Decorative unless given a label.

import { useId } from 'react'
import { svgNumber } from '../../lib/chartScale'

const WIDTH = 80
const HEIGHT = 24
/** Room at the top and bottom so the stroke and end dot are not cut off. */
const PAD = 2

interface Point {
  x: number
  y: number
}

/** Each value's place in the box, lowest value at the bottom. */
function place(values: readonly number[]): Point[] {
  if (values.length < 2) return []
  const low = Math.min(...values)
  const span = Math.max(...values) - low || 1
  return values.map((value, index) => ({
    x: (index / (values.length - 1)) * WIDTH,
    y: HEIGHT - PAD - ((value - low) / span) * (HEIGHT - PAD * 2),
  }))
}

/** The line's points across the box, as an SVG points list; empty under two values. */
export function sparkPoints(values: readonly number[]): string {
  return place(values)
    .map(({ x, y }) => `${svgNumber(x)},${svgNumber(y)}`)
    .join(' ')
}

/** The shape under the line, closed along the bottom of the box. */
export function sparkArea(values: readonly number[]): string {
  const points = place(values)
  if (points.length === 0) return ''
  const line = points.map(({ x, y }) => `L${svgNumber(x)} ${svgNumber(y)}`).join(' ')
  return `M0 ${HEIGHT} ${line} L${WIDTH} ${HEIGHT} Z`
}

export function Sparkline({
  values,
  label,
  area = false,
  wide = false,
}: {
  values: readonly number[]
  label?: string
  /** Fill under the line and mark its last point. */
  area?: boolean
  /** Take the full width of its box, as in a drill-down, instead of 80px. */
  wide?: boolean
}) {
  // Each sparkline's fill needs its own gradient id on the page.
  const gradient = `spark-fill-${useId().replace(/:/g, '')}`
  const points = place(values)
  if (points.length === 0) return null
  const last = points[points.length - 1]!
  return (
    <svg
      className={wide ? 'spark spark-wide' : 'spark'}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      preserveAspectRatio="none"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {area && (
        <>
          <defs>
            <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" className="spark-fill-top" />
              <stop offset="100%" className="spark-fill-bottom" />
            </linearGradient>
          </defs>
          <path className="spark-area" d={sparkArea(values)} fill={`url(#${gradient})`} />
        </>
      )}
      <polyline points={sparkPoints(values)} />
      {area && (
        // A zero-length line with round caps: a dot that stays round when the box stretches.
        <line
          className="spark-end"
          x1={svgNumber(last.x)}
          y1={svgNumber(last.y)}
          x2={svgNumber(last.x)}
          y2={svgNumber(last.y)}
        />
      )}
    </svg>
  )
}
