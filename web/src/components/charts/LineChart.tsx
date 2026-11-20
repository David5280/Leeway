// A line over time, used for net worth. It can go below zero, unlike the
// spending charts, and points are placed by date so a month's gap looks like one.

import { useId, type ReactNode } from 'react'
import { useApp } from '../../lib/app'
import { axisFormat, niceTicks, textWidth } from '../../lib/chartScale'
import { toDayNumber } from '../../lib/dates'
import { shortDate } from '../../lib/format'
import { useWidth } from '../../lib/useWidth'
import { Money } from '../design/Money'
import { EndPoint, type LineReference, ReferenceLine, ShadedLine, TimeAxis } from './lineParts'
import { ChartFrame, Guide, PointerLayer, Readout, usePointer, ValueAxis } from './parts'

export type { LineReference } from './lineParts'

export interface LinePoint {
  date: string
  cents: number
}

/**
 * Where the plot sits in a chart `width` pixels wide. The full chart keeps a
 * gutter for value labels on the left and the latest value on the right;
 * compact draws edge to edge.
 */
export function lineFrame(compact: boolean, width: number, tickLabels: string[], endLabel: string) {
  if (compact) return { height: 72, left: 2, right: width - 6, top: 8, bottom: 68 }
  const height = width < 420 ? 210 : 250
  return {
    height,
    left: Math.max(0, ...tickLabels.map((label) => textWidth(label))) + 12,
    right: width - textWidth(endLabel, 13) - 18,
    top: 14,
    bottom: height - 30,
  }
}

/**
 * The full chart has value and date axes and the latest value at the line's
 * end. Compact draws the line and its shading alone, for a dashboard widget.
 * A reference, when given, is a dashed level labelled with where the line
 * should be; without one the chart draws exactly as before. Details add lines
 * under a tapped point's amount, like what was owned and owed that day.
 */
export function LineChart({
  points,
  label,
  description,
  compact = false,
  reference,
  details,
}: {
  points: LinePoint[]
  label: string
  description: string
  compact?: boolean
  reference?: LineReference
  /** More lines for the readout of the point at this index. */
  details?: (index: number) => ReactNode[]
}) {
  const { money, settings } = useApp()
  const [measure, width] = useWidth<HTMLDivElement>(640)
  const gradientId = useId()
  const values = axisValues(points, reference)
  const axis = niceTicks(Math.min(...values), Math.max(...values), width < 420 ? 4 : 5)
  const format = axisFormat(axis.values, settings)
  const last = points.at(-1)
  const frame = lineFrame(compact, width, axis.values.map(format), last ? money(last.cents) : '')
  const { left, right, top, bottom, height } = frame

  const first = toDayNumber(points[0]?.date ?? '2000-01-01')
  const span = Math.max(1, toDayNumber(last?.date ?? '2000-01-01') - first)
  const x = (date: string) => left + ((right - left) * (toDayNumber(date) - first)) / span
  const y = (cents: number) =>
    bottom - ((bottom - top) * (cents - axis.low)) / (axis.high - axis.low)
  const placed = points.map((p) => ({ x: x(p.date), y: y(p.cents) }))
  const pointer = usePointer(compact ? [] : placed.map((p) => p.x), width)
  const hovered = points[pointer.active]
  // Shade toward zero, or toward the axis floor when every value is above it.
  const baseline = y(Math.max(axis.low, Math.min(0, axis.high)))

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
            lines={readoutLines(hovered.cents, pointer.active, details)}
          />
        )
      }
    >
      <defs>
        <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="var(--accent)" stopOpacity="0.24" />
          <stop offset="1" stopColor="var(--accent)" stopOpacity="0" />
        </linearGradient>
      </defs>
      {!compact && (
        <>
          <ValueAxis ticks={axis.values} y={y} left={left} right={right} format={format} />
          <TimeAxis
            dates={points.map((p) => p.date)}
            x={x}
            left={left}
            right={right}
            y={height - 8}
          />
          <ReferenceLine
            reference={reference}
            y={y}
            left={left}
            right={right}
            top={top}
            bottom={bottom}
            line={placed}
          />
        </>
      )}
      <ShadedLine points={placed} baseline={baseline} fill={`url(#${gradientId})`} />
      {last && (
        <EndPoint at={placed.at(-1)!} cents={compact ? null : last.cents} labelX={right + 10} />
      )}
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
      {!compact && (
        <PointerLayer
          left={left}
          top={top}
          width={right - left}
          height={bottom - top}
          handlers={pointer.handlers}
        />
      )}
    </ChartFrame>
  )
}

/** A tapped point's amount, then any details for it. */
function readoutLines(
  cents: number,
  index: number,
  details: ((index: number) => ReactNode[]) | undefined,
): ReactNode[] {
  return [<Money cents={cents} />, ...(details ? details(index) : [])]
}

/** The amounts the value axis must show: every point, and the reference level if any. */
function axisValues(points: LinePoint[], reference: LineReference | undefined): number[] {
  const values = points.map((p) => p.cents)
  return reference ? [...values, reference.cents] : values
}
