// A small line of how a number moved, for where the trend matters more than
// the values: a card's corner, a row's end. Decorative unless given a label.

import { svgNumber } from '../../lib/chartScale'

const WIDTH = 80
const HEIGHT = 24
/** Room at the top and bottom so the stroke is not cut off. */
const PAD = 2

/** The line's points across the box, lowest value at the bottom. */
export function sparkPoints(values: readonly number[]): string {
  if (values.length < 2) return ''
  const low = Math.min(...values)
  const span = Math.max(...values) - low || 1
  return values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * WIDTH
      const y = HEIGHT - PAD - ((value - low) / span) * (HEIGHT - PAD * 2)
      return `${svgNumber(x)},${svgNumber(y)}`
    })
    .join(' ')
}

export function Sparkline({ values, label }: { values: readonly number[]; label?: string }) {
  const points = sparkPoints(values)
  if (!points) return null
  return (
    <svg
      className="spark"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      preserveAspectRatio="none"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <polyline points={points} />
    </svg>
  )
}
