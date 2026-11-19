// A range over the years: a shaded band from the low case to the high case
// with the middle case drawn as a line, by age. Used for a retirement
// projection, where one line would read as a promise.

import { useApp } from '../../lib/app'
import { axisFormat, niceTicks, textWidth } from '../../lib/chartScale'
import { useWidth } from '../../lib/useWidth'
import { ChartFrame, Guide, PointerLayer, Readout, usePointer, ValueAxis } from './parts'

export interface BandPoint {
  age: number
  low: number
  mid: number
  high: number
}

/** About one age label per this many pixels, so labels never crowd on a phone. */
const PIXELS_PER_LABEL = 70

/** The ages to label: the first, the last, and evenly spaced whole steps between. */
export function ageTicks(first: number, last: number, maxLabels: number): number[] {
  const span = last - first
  if (span <= 0) return [first]
  const step = Math.max(1, Math.ceil(span / Math.max(1, maxLabels - 1)))
  const ticks: number[] = []
  for (let age = first; age < last; age += step) ticks.push(age)
  // The last age always shows; drop the one before it when the two would crowd.
  if (ticks.length > 1 && last - ticks.at(-1)! < step / 2) ticks.pop()
  return [...ticks, last]
}

/** The path that outlines the band: along the high case, then back along the low. */
export function bandPath(xs: number[], highs: number[], lows: number[]): string {
  const top = xs.map((x, i) => `${i === 0 ? 'M' : 'L'}${x},${highs[i]}`)
  const bottom = xs.map((_, i) => xs.length - 1 - i).map((i) => `L${xs[i]},${lows[i]}`)
  return `${top.join(' ')} ${bottom.join(' ')} Z`
}

export function BandChart({
  points,
  label,
  description,
  money,
}: {
  points: BandPoint[]
  label: string
  description: string
  /** Whole amounts for the readout, from the caller's money format. */
  money: (cents: number) => string
}) {
  const { settings } = useApp()
  const [measure, width] = useWidth<HTMLDivElement>(640)
  const axis = niceTicks(0, Math.max(...points.map((p) => p.high)), width < 420 ? 4 : 5)
  const format = axisFormat(axis.values, settings)
  const height = width < 420 ? 200 : 240
  const left = Math.max(...axis.values.map((v) => textWidth(format(v)))) + 12
  const right = width - 12
  const top = 12
  const bottom = height - 28

  const first = points[0]!.age
  const span = Math.max(1, points.at(-1)!.age - first)
  const x = (age: number) => left + ((right - left) * (age - first)) / span
  const y = (cents: number) =>
    bottom - ((bottom - top) * (cents - axis.low)) / (axis.high - axis.low)
  const xs = points.map((p) => x(p.age))
  const pointer = usePointer(xs, width)
  const hovered = points[pointer.active]
  const ticks = ageTicks(first, points.at(-1)!.age, Math.floor((right - left) / PIXELS_PER_LABEL))

  return (
    <ChartFrame
      measure={measure}
      width={width}
      height={height}
      name={label}
      description={description}
      readout={
        hovered && (
          <Readout
            x={x(hovered.age)}
            chartWidth={width}
            title={`At ${hovered.age}`}
            lines={[
              `${money(hovered.low)} to ${money(hovered.high)}`,
              `Middle ${money(hovered.mid)}`,
            ]}
          />
        )
      }
    >
      <ValueAxis ticks={axis.values} y={y} left={left} right={right} format={format} />
      <g aria-hidden="true">
        {ticks.map((age) => (
          <text key={age} x={x(age)} y={height - 8} textAnchor="middle" className="chart-axis">
            {age}
          </text>
        ))}
      </g>
      <path
        d={bandPath(
          xs,
          points.map((p) => y(p.high)),
          points.map((p) => y(p.low)),
        )}
        className="chart-band"
        aria-hidden="true"
      />
      <polyline
        points={points.map((p) => `${x(p.age)},${y(p.mid)}`).join(' ')}
        className="chart-line actual"
        fill="none"
        aria-hidden="true"
      />
      {hovered && (
        <>
          <Guide x={x(hovered.age)} top={top} bottom={bottom} />
          <circle cx={x(hovered.age)} cy={y(hovered.mid)} r="4" className="chart-dot" />
        </>
      )}
      <PointerLayer
        left={left}
        top={top}
        width={right - left}
        height={bottom - top}
        handlers={pointer.handlers}
      />
    </ChartFrame>
  )
}
