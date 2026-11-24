// The spending pace chart: flexible spending so far against a steady pace to
// the budget, with where the current rate lands by the end of the period.

import { useId } from 'react'
import { useApp } from '../../lib/app'
import { axisFormat, axisIndices, spreadLabels, svgNumber } from '../../lib/chartScale'
import { addDays } from '../../lib/dates'
import { shortDate } from '../../lib/format'
import { useWidth } from '../../lib/useWidth'
import { Money } from '../design/Money'
import {
  edgeAnchor,
  paceAxis,
  paceEndLabels,
  paceFrame,
  paceState,
  spentLabel,
  steadyAt,
  steadyLabel,
  type Box,
  type Pace,
  type Point,
  type SteadyLabelSpot,
} from './pace'
import {
  ChartFrame,
  END_LABEL_GAP,
  EndLabel,
  Guide,
  PointerLayer,
  Readout,
  usePointer,
  ValueAxis,
} from './parts'

export function PaceChart({ pace, isCurrent }: { pace: Pace; isCurrent: boolean }) {
  const { settings, money } = useApp()
  const [measure, width] = useWidth<HTMLDivElement>(640)
  const clipId = useId()

  const state = paceState(pace, isCurrent)
  const axis = paceAxis(
    pace.budgetCents,
    state.spentCents,
    state.projecting ? pace.projectedCents : state.spentCents,
  )
  const format = axisFormat(axis.values, settings)
  const ends = paceEndLabels(pace, state)
  const frame = paceFrame(
    width,
    axis.values.map(format),
    ends.map((label) => money(label.cents)),
  )
  const { left, right, top, bottom, height } = frame
  const x = (day: number) => left + ((right - left) * day) / Math.max(1, pace.days - 1)
  const y = (cents: number) => bottom - ((bottom - top) * cents) / axis.high

  const points = pace.cumulative.map((point, i) => ({ x: x(i), y: y(point.cents) }))
  const pointer = usePointer(
    points.map((p) => p.x),
    width,
  )
  const hovered = pace.cumulative[pointer.active]
  const endYs = spreadLabels(
    ends.map((label) => y(Math.min(label.cents, axis.high)) - 6),
    END_LABEL_GAP,
    top,
    bottom - END_LABEL_GAP / 2,
  )
  const today = points[state.lastIndex]
  // Today's amount, which the steady pace's label keeps clear of.
  const spent =
    state.projecting && today ? spentLabel(today, money(state.spentCents), left) : undefined
  const steady = { from: { x: x(0), y: y(0) }, to: { x: x(pace.days - 1), y: y(pace.budgetCents) } }
  const steadyText = steadyTextFor(pace, steady, { left, bottom }, today, spent?.box)

  return (
    <ChartFrame
      measure={measure}
      width={width}
      height={height}
      name="Flexible spending pace"
      description={describePace(pace, state, money, settings.locale)}
      readout={
        hovered && (
          <Readout
            x={points[pointer.active]!.x}
            chartWidth={width}
            title={shortDate(hovered.date, settings.locale)}
            lines={[
              <>
                <Money cents={hovered.cents} /> spent
              </>,
              <>
                Steady pace <Money cents={steadyAt(pace.budgetCents, pointer.active, pace.days)} />
              </>,
            ]}
          />
        )
      }
    >
      <defs>
        <clipPath id={clipId}>
          <rect x={left} y={top} width={Math.max(0, right - left)} height={bottom - top} />
        </clipPath>
        <linearGradient id={`${clipId}-fill`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="var(--place-mark)" stopOpacity="0.22" />
          <stop offset="1" stopColor="var(--place-mark)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <ValueAxis ticks={axis.values} y={y} left={left} right={right} format={format} />
      <DateAxis
        pace={pace}
        x={x}
        y={height - 8}
        maxLabels={Math.floor((right - left) / 90) + 1}
        locale={settings.locale}
      />
      {state.projecting && today && <TodayMarker x={today.x} top={top} bottom={bottom} />}
      <g clipPath={`url(#${clipId})`}>
        {pace.budgetCents > 0 && (
          <SteadyPace {...steady} left={left} right={right} label={steadyText} />
        )}
        <ActualLine points={points} bottom={bottom} fill={`url(#${clipId}-fill)`} />
        {state.projecting && today && (
          <path
            d={`M${today.x},${today.y} L${x(pace.days - 1)},${y(pace.projectedCents)}`}
            className="chart-line projected"
          />
        )}
      </g>
      {/* A label moved off its usual place may cross the spending line, so it is drawn over it. */}
      <MovedSteadyText label={steadyText} />
      {spent && today && <SpentDot at={today} cents={state.spentCents} x={spent.x} />}
      {ends.map((label, i) => (
        <EndLabel
          key={label.name}
          x={right + 10}
          y={endYs[i]!}
          name={label.name}
          value={<Money as="tspan" cents={label.cents} />}
          tone={label.tone}
        />
      ))}
      {hovered && <HoverMark at={points[pointer.active]!} top={top} bottom={bottom} />}
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

/** The chart in one sentence, for screen readers. */
function describePace(
  pace: Pace,
  state: ReturnType<typeof paceState>,
  money: (cents: number) => string,
  locale: string,
): string {
  const by = shortDate(pace.cumulative.at(-1)?.date ?? pace.start, locale)
  const range = `${shortDate(pace.start, locale)} to ${shortDate(pace.end, locale)}`
  const heading = state.projecting ? `, on track for ${money(pace.projectedCents)}` : ''
  return `${money(state.spentCents)} spent by ${by} against a ${money(pace.budgetCents)} budget for ${range}${heading}.`
}

/** The dates along the bottom: the period's first and last day and a few between. */
function DateAxis({
  pace,
  x,
  y,
  maxLabels,
  locale,
}: {
  pace: Pace
  x: (day: number) => number
  y: number
  maxLabels: number
  locale: string
}) {
  return (
    <g aria-hidden="true">
      {axisIndices(pace.days, maxLabels).map((index) => (
        <text
          key={index}
          x={x(index)}
          y={y}
          textAnchor={edgeAnchor(index, pace.days)}
          className="chart-axis"
        >
          {shortDate(addDays(pace.start, index), locale)}
        </text>
      ))}
    </g>
  )
}

/** Spending so far, shaded beneath. */
function ActualLine({ points, bottom, fill }: { points: Point[]; bottom: number; fill: string }) {
  if (points.length === 0) return null
  const line = points.map((p) => `${svgNumber(p.x)},${svgNumber(p.y)}`).join(' L')
  return (
    <>
      {points.length > 1 && (
        <path
          d={`M${points[0]!.x},${bottom} L${line} L${points.at(-1)!.x},${bottom} Z`}
          fill={fill}
        />
      )}
      <path d={`M${line}`} className="chart-line actual" />
    </>
  )
}

/** A thin vertical line at today, named at the top. */
function TodayMarker({ x, top, bottom }: { x: number; top: number; bottom: number }) {
  return (
    <g aria-hidden="true">
      <line x1={x} x2={x} y1={top - 4} y2={bottom} className="chart-today" />
      <text x={x} y={top - 10} textAnchor="middle" className="chart-axis strong-label">
        Today
      </text>
    </g>
  )
}

/** Where "Steady pace" sits on this chart, or nothing with no budget to climb to. */
function steadyTextFor(
  pace: Pace,
  steady: { from: Point; to: Point },
  plot: { left: number; bottom: number },
  today: Point | undefined,
  spent: Box | undefined,
): SteadyLabelSpot | undefined {
  if (pace.budgetCents <= 0) return undefined
  // Today's dot and the box of its amount, when there is one to keep clear of.
  const avoid = today && spent ? { today, spent } : undefined
  return steadyLabel({
    label: STEADY_LABEL,
    ...steady,
    ...plot,
    labelBelow: pace.projectedCents > pace.budgetCents,
    avoid,
  })
}

/** The budget line and the steady pace climbing to it, with its label where it usually sits. */
function SteadyPace({
  from,
  to,
  left,
  right,
  label,
}: {
  from: Point
  to: Point
  left: number
  right: number
  label?: SteadyLabelSpot
}) {
  return (
    <g aria-hidden="true">
      <line x1={left} x2={right} y1={to.y} y2={to.y} className="chart-line budget" />
      <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} className="chart-line steady" />
      {label && !label.moved && <SteadyText label={label} />}
    </g>
  )
}

/** The steady pace's label over the spending line, only when it moved off its usual place. */
function MovedSteadyText({ label }: { label: SteadyLabelSpot | undefined }) {
  return label?.moved ? <SteadyText label={label} halo /> : null
}

/** "Steady pace", turned along the slope; with a halo when it sits over the spending line. */
function SteadyText({ label, halo = false }: { label: SteadyLabelSpot; halo?: boolean }) {
  const { at, offset, angle } = label
  return (
    <text
      x={at.x}
      y={at.y + offset}
      textAnchor="middle"
      transform={`rotate(${svgNumber(angle)} ${at.x} ${at.y})`}
      className={halo ? 'chart-axis halo' : 'chart-axis'}
      aria-hidden={halo || undefined}
    >
      {STEADY_LABEL}
    </text>
  )
}

const STEADY_LABEL = 'Steady pace'

/** Today's spending: a dot on the line with its amount up and to the left, ending at `x`. */
function SpentDot({ at, cents, x }: { at: Point; cents: number; x: number }) {
  return (
    <g aria-hidden="true">
      <circle cx={at.x} cy={at.y} r="5" className="chart-dot" />
      <text x={x} y={at.y - 12} textAnchor="end" className="chart-value ink halo">
        <Money as="tspan" cents={cents} />
      </text>
    </g>
  )
}

/** The guide and dot for the day under the pointer. */
function HoverMark({ at, top, bottom }: { at: Point; top: number; bottom: number }) {
  return (
    <>
      <Guide x={at.x} top={top} bottom={bottom} />
      <circle cx={at.x} cy={at.y} r="4" className="chart-dot" />
    </>
  )
}
