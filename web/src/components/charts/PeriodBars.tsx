// Bars per budget period, each labeled with its amount, against the budget.
// Bars are plain, green for money in, and red only where spending went over
// its budget. A period with nothing in it keeps a stub on the baseline, so the
// gap reads as $0 rather than a missing period.

import { useApp } from '../../lib/app'
import { axisFormat, niceTicks, textWidth, type Ticks } from '../../lib/chartScale'
import { formatMoney, type MoneyOptions, type Precision } from '../../lib/money'
import { Money } from '../design/Money'
import { useWidth } from '../../lib/useWidth'
import { ChartFrame, EndLabel, PointerLayer, Readout, usePointer, ValueAxis } from './parts'

export interface PeriodBar {
  label: string
  cents: number
  /** The period still running; it is drawn lighter, as it is still filling up. */
  current: boolean
}

/** A bar with rounded top corners only, so it sits flat on the baseline. */
export function barPath(x: number, y: number, width: number, bottom: number): string {
  const height = bottom - y
  if (height <= 0) return ''
  const r = Math.min(4, width / 2, height)
  return `M${x},${bottom} V${y + r} Q${x},${y} ${x + r},${y} H${x + width - r} Q${x + width},${y} ${x + width},${y + r} V${bottom} Z`
}

/** The value axis: from zero to past the tallest bar or the budget, with headroom for amounts. */
export function barAxis(values: number[], budget: number | null): Ticks {
  return niceTicks(0, Math.max(budget ?? 0, ...values) * 1.12, 4)
}

/**
 * Where the bars go in a chart `width` pixels wide: the plot's edges and each
 * bar's slot and width, leaving gutters for the value labels on the left and
 * the budget's label on the right.
 */
export function barLayout(count: number, width: number, tickLabels: string[], budgetLabel: string) {
  const height = width < 420 ? 200 : 230
  const left = Math.max(0, ...tickLabels.map((label) => textWidth(label))) + 12
  const right = width - (budgetLabel ? Math.max(64, textWidth(budgetLabel, 13) + 14) : 8)
  // Each bar gets an equal slot and fills at most 62% of it.
  const slot = (right - left) / Math.max(1, count)
  return {
    height,
    left,
    right,
    top: 22,
    bottom: height - 28,
    slot,
    barWidth: Math.min(56, slot * 0.62),
  }
}

/**
 * How the amount over each bar is written: whole units when every one fits
 * its slot, then shortened ("$1.2K"), or null when even those crowd, so only
 * the current period's is shown.
 */
export function barPrecision(
  values: number[],
  slot: number,
  options: MoneyOptions,
): Precision | null {
  const fits = (precision: Precision) =>
    values.every((cents) => textWidth(formatMoney(cents, options, { precision }), 13) <= slot - 4)
  if (fits('whole')) return 'whole'
  return fits('compact') ? 'compact' : null
}

/** A bar's fill: green for money in, red for spending over its budget, plain otherwise. */
export function barTone(
  cents: number,
  budget: number | null,
  moneyIn: boolean,
  overIsProblem: boolean,
): string {
  if (moneyIn) return 'var(--tone-in)'
  return overIsProblem && budget !== null && cents > budget
    ? 'var(--tone-problem)'
    : 'var(--tone-muted)'
}

/**
 * Which bars get a date under them: every one when they fit, else every n-th
 * counted back from the newest, so the gaps are even and the running period
 * is always named.
 */
export function labelledBars(count: number, slot: number, labelRoom: number): Set<number> {
  const step = Math.max(1, Math.ceil(labelRoom / Math.max(1, slot)))
  const chosen = new Set<number>()
  for (let index = count - 1; index >= 0; index -= step) chosen.add(index)
  return chosen
}

/** A period with nothing in it: a short stub on the baseline, so its slot is not mistaken for a gap. */
const STUB_HEIGHT = 2

export function PeriodBars({
  bars,
  budgetCents,
  label,
  levelName = 'Budget',
  moneyIn = false,
  overIsProblem = false,
}: {
  bars: PeriodBar[]
  /** The dashed level each bar reads against; null leaves it out. */
  budgetCents: number | null
  label: string
  /** What the level is, written at its end: the budget, or the usual period without one. */
  levelName?: string
  /** Money coming in, drawn green. */
  moneyIn?: boolean
  /** Whether going over the level is a problem, as spending over a budget is: those bars are red. */
  overIsProblem?: boolean
}) {
  const { settings, money } = useApp()
  const [measure, width] = useWidth<HTMLDivElement>(540)
  const budget = budgetCents !== null && budgetCents > 0 ? budgetCents : null
  // A period with net refunds draws as an empty bar rather than below the axis.
  const values = bars.map((bar) => Math.max(0, bar.cents))
  const axis = barAxis(values, budget)
  const format = axisFormat(axis.values, settings)
  const layout = barLayout(
    bars.length,
    width,
    axis.values.map(format),
    budget === null ? '' : money(budget),
  )
  const { height, left, right, top, bottom, slot, barWidth } = layout
  const y = (cents: number) => bottom - ((bottom - top) * cents) / axis.high
  const center = (i: number) => left + slot * i + slot / 2
  const positions = bars.map((_, i) => center(i))
  const pointer = usePointer(positions, width)
  const hovered = bars[pointer.active]
  const precision = barPrecision(values, slot, settings)
  // Each date label needs its own width and a gap, so neighbors never touch.
  const labelRoom = Math.max(0, ...bars.map((bar) => textWidth(bar.label))) + 12
  const dateLabels = labelledBars(bars.length, slot, labelRoom)
  const over = (cents: number) => overIsProblem && budget !== null && cents > budget
  const budgetText = budget !== null ? `. ${levelName} ${money(budget)}.` : ''
  const empty = values.every((v) => v === 0)

  return (
    <ChartFrame
      measure={measure}
      width={width}
      height={height}
      name={label}
      description={`${bars.map((b) => `${b.label} ${money(b.cents)}${over(b.cents) ? ' (over budget)' : ''}`).join(', ')}${budgetText}`}
      readout={
        hovered && (
          <Readout
            x={positions[pointer.active]!}
            chartWidth={width}
            title={hovered.label}
            lines={[
              <>
                <Money cents={hovered.cents} />
                {hovered.current ? ' so far' : ''}
              </>,
            ]}
          />
        )
      }
    >
      {/* With nothing to measure the scale means nothing, and its labels would crowd the note. */}
      {!empty && <ValueAxis ticks={axis.values} y={y} left={left} right={right} format={format} />}
      {bars.map((bar, i) => {
        const fill = barTone(values[i]!, budget, moneyIn, overIsProblem)
        // An empty period still gets a stub, so it reads as $0 and not as a gap.
        const top = values[i]! > 0 ? y(values[i]!) : bottom - STUB_HEIGHT
        return (
          <path
            key={bar.label}
            d={barPath(center(i) - barWidth / 2, top, barWidth, bottom)}
            fill={fill}
            // The running period is drawn lighter and outlined: it is still filling up.
            fillOpacity={bar.current ? 0.45 : 1}
            stroke={bar.current ? fill : 'none'}
            strokeWidth="1.5"
            opacity={hovered && hovered !== bar ? 0.55 : 1}
            aria-hidden="true"
          />
        )
      })}
      {budget !== null && (
        <>
          <line x1={left} x2={right} y1={y(budget)} y2={y(budget)} className="chart-line budget" />
          <EndLabel
            x={right + 10}
            y={y(budget) - 6}
            name={levelName}
            value={<Money as="tspan" cents={budget} />}
          />
        </>
      )}
      <g aria-hidden="true">
        {bars.map((bar, i) => (
          <g key={bar.label}>
            {values[i]! > 0 && (
              <text
                x={center(i)}
                y={y(values[i]!) - 7}
                textAnchor="middle"
                className="chart-value ink halo"
              >
                <BarAmount
                  cents={values[i]!}
                  precision={precision ?? (bar.current ? 'compact' : null)}
                />
              </text>
            )}
            {dateLabels.has(i) && (
              <text
                x={center(i)}
                y={height - 8}
                textAnchor="middle"
                className={bar.current ? 'chart-axis strong-label' : 'chart-axis'}
              >
                {bar.label}
              </text>
            )}
          </g>
        ))}
      </g>
      {empty && (
        <text
          x={(left + right) / 2}
          y={(top + bottom) / 2}
          textAnchor="middle"
          className="chart-axis"
        >
          Nothing in these periods yet
        </text>
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

/** The amount over a bar, or nothing when there is no room for it. */
function BarAmount({ cents, precision }: { cents: number; precision: Precision | null }) {
  return precision && <Money as="tspan" cents={cents} precision={precision} />
}
