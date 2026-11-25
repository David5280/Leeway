// The cash in checking from today to payday, stepping down on each bill's
// day. The scale is a close-up of the line, so a $80 bill shows as a step
// even in thousands, and $0 joins it only when the line comes near: then
// "Stay above: $0" is drawn, and any part of the line below it is red.

import { useId } from 'react'
import { useApp } from '../../lib/app'
import { axisFormat, niceTicks, type Ticks } from '../../lib/chartScale'
import type { CashPoint } from '../../lib/cashPath'
import { toDayNumber } from '../../lib/dates'
import { shortDate } from '../../lib/format'
import { useWidth } from '../../lib/useWidth'
import { Money } from '../design/Money'
import { lineFrame } from './LineChart'
import { EndPoint, ReferenceLine, ShadedLine, TimeAxis } from './lineParts'
import { ChartFrame, Guide, PointerLayer, Readout, usePointer, ValueAxis } from './parts'

/** The scale for the line, and whether $0 is on it. */
export interface CashScale {
  axis: Ticks
  /** Whether the line comes near $0, so the level to stay above is drawn. */
  showFloor: boolean
}

/** At least this much room above and below a close-up line, in cents. */
const MIN_PAD_CENTS = 1_000

/**
 * The value axis for a cash line. Near $0, which means the lowest point is
 * within one drop of the bills of it, or below it, the axis runs from $0 so
 * the level to stay above shows. Otherwise it is a close-up of the line with
 * a quarter of the drop as room above and below.
 */
export function cashScale(points: Pick<CashPoint, 'cents'>[], maxTicks: number): CashScale {
  const values = points.map((point) => point.cents)
  const low = Math.min(...values)
  const high = Math.max(...values)
  const drop = high - low
  if (low <= drop) return { axis: niceTicks(Math.min(0, low), high, maxTicks), showFloor: true }
  const pad = Math.max(drop / 4, MIN_PAD_CENTS)
  return { axis: niceTicks(low - pad, high + pad, maxTicks, false), showFloor: false }
}

export function CashLine({
  points,
  label,
  description,
}: {
  points: CashPoint[]
  label: string
  description: string
}) {
  const { money, settings } = useApp()
  const [measure, width] = useWidth<HTMLDivElement>(640)
  const ids = { fill: useId(), below: useId() }
  const { axis, showFloor } = cashScale(points, width < 420 ? 4 : 5)
  const format = axisFormat(axis.values, settings)
  const last = points.at(-1)!
  const frame = lineFrame(false, width, axis.values.map(format), money(last.cents))
  const { left, right, top, bottom, height } = frame
  const first = toDayNumber(points[0]!.date)
  const span = Math.max(1, toDayNumber(last.date) - first)
  const x = (date: string) => left + ((right - left) * (toDayNumber(date) - first)) / span
  const y = (cents: number) =>
    bottom - ((bottom - top) * (cents - axis.low)) / (axis.high - axis.low)
  const placed = points.map((point) => ({ x: x(point.date), y: y(point.cents) }))
  const pointer = usePointer(
    placed.map((point) => point.x),
    width,
  )
  const hovered = points[pointer.active]
  // The first day below $0, marked so the dip reads at a glance; -1 when it stays above.
  const dip = points.findIndex((point) => point.cents < 0)
  const floor = y(Math.max(axis.low, Math.min(0, axis.high)))

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
            x={placed[pointer.active]!.x}
            chartWidth={width}
            title={shortDate(hovered.date, settings.locale)}
            lines={[
              <Money cents={hovered.cents} />,
              ...(hovered.bills.length ? [`${hovered.bills.join(', ')} due`] : []),
            ]}
          />
        )
      }
    >
      <defs>
        <linearGradient id={ids.fill} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="var(--place-mark)" stopOpacity="0.24" />
          <stop offset="1" stopColor="var(--place-mark)" stopOpacity="0" />
        </linearGradient>
        {/* Everything under $0, so the line there can be drawn again in red. */}
        <clipPath id={ids.below}>
          <rect x={0} y={y(0)} width={width} height={Math.max(0, bottom - y(0))} />
        </clipPath>
      </defs>
      <ValueAxis ticks={axis.values} y={y} left={left} right={right} format={format} />
      <TimeAxis
        dates={points.map((point) => point.date)}
        x={x}
        left={left}
        right={right}
        y={height - 8}
      />
      {showFloor && (
        <ReferenceLine
          reference={{ cents: 0, label: 'Stay above' }}
          y={y}
          left={left}
          right={right}
          top={top}
          bottom={bottom}
          line={placed}
        />
      )}
      <ShadedLine points={placed} baseline={floor} fill={`url(#${ids.fill})`} />
      {points.some((point) => point.cents < 0) && (
        <g clipPath={`url(#${ids.below})`} aria-hidden="true">
          <path
            d={`M${placed.map((point) => `${point.x},${point.y}`).join(' L')}`}
            className="chart-line problem"
          />
        </g>
      )}
      {dip >= 0 && (
        <circle
          cx={placed[dip]!.x}
          cy={placed[dip]!.y}
          r="4"
          className="chart-dot problem"
          aria-hidden="true"
          data-testid="cash-dip"
        />
      )}
      <EndPoint at={placed.at(-1)!} cents={last.cents} labelX={right + 10} />
      {hovered && (
        <>
          <Guide x={placed[pointer.active]!.x} top={top} bottom={bottom} />
          <circle
            cx={placed[pointer.active]!.x}
            cy={placed[pointer.active]!.y}
            r="4"
            className="chart-dot"
          />
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
