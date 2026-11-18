// A line over time, used for net worth. It can go below zero, unlike the
// spending charts, and points are placed by date so a month's gap looks like one.

import { useId } from 'react'
import { useApp } from '../../lib/app'
import { axisFormat, niceTicks, textWidth, timeTicks, type TimeTick } from '../../lib/chartScale'
import { toDayNumber } from '../../lib/dates'
import { monthYear, shortDate } from '../../lib/format'
import { useWidth } from '../../lib/useWidth'
import { ChartFrame, Guide, PointerLayer, Readout, usePointer, ValueAxis } from './parts'

export interface LinePoint {
  date: string
  cents: number
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
 */
export function LineChart({
  points,
  label,
  description,
  compact = false,
}: {
  points: LinePoint[]
  label: string
  description: string
  compact?: boolean
}) {
  const { money, settings } = useApp()
  const [measure, width] = useWidth<HTMLDivElement>(640)
  const gradientId = useId()
  const values = points.map((p) => p.cents)
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
            lines={[money(hovered.cents)]}
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
            points={points}
            x={x}
            y={height - 8}
            width={right - left}
            locale={settings.locale}
          />
        </>
      )}
      <ShadedLine points={placed} baseline={baseline} fill={`url(#${gradientId})`} />
      {last && (
        <EndPoint
          at={placed.at(-1)!}
          label={compact ? null : money(last.cents)}
          labelX={right + 10}
        />
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

/** Date labels along the bottom, about one per 80 pixels. */
function TimeAxis({
  points,
  x,
  y,
  width,
  locale,
}: {
  points: LinePoint[]
  x: (date: string) => number
  y: number
  width: number
  locale: string
}) {
  if (points.length < 2) return null
  const ticks = timeTicks(points[0]!.date, points.at(-1)!.date, Math.floor(width / 80))
  return (
    <g aria-hidden="true">
      {ticks.map((tick) => (
        <text key={tick.date} x={x(tick.date)} y={y} textAnchor="middle" className="chart-axis">
          {timeTickLabel(tick, locale)}
        </text>
      ))}
    </g>
  )
}

/** The line with a soft fill down to the baseline. */
function ShadedLine({
  points,
  baseline,
  fill,
}: {
  points: { x: number; y: number }[]
  baseline: number
  fill: string
}) {
  if (points.length < 2) return null
  const line = points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' L')
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
function EndPoint({
  at,
  label,
  labelX,
}: {
  at: { x: number; y: number }
  label: string | null
  labelX: number
}) {
  return (
    <>
      <circle cx={at.x} cy={at.y} r="4" className="chart-dot" />
      {label && (
        <text x={labelX} y={at.y + 4} className="chart-value ink" aria-hidden="true">
          {label}
        </text>
      )}
    </>
  )
}
