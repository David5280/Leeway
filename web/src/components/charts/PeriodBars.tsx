// Bars per budget period, each labeled with its amount, against the budget.

import { useApp } from '../../lib/app'
import { axisFormat, axisIndices, niceTicks, textWidth, type Ticks } from '../../lib/chartScale'
import { compactMoney, money as formatMoney, type MoneyOptions } from '../../lib/money'
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
 * The amount over each bar: whole units when every one fits its slot, then
 * shortened ("$1.2K"), and only the current period's when even those crowd.
 */
export function barAmounts(values: number[], slot: number, options: MoneyOptions): string[] {
  const fits = (labels: string[]) => labels.every((text) => textWidth(text, 13) <= slot - 4)
  const whole = values.map((v) => formatMoney(v, options))
  if (fits(whole)) return whole
  const short = values.map((v) => compactMoney(v, options))
  return fits(short) ? short : short.map(() => '')
}

export function PeriodBars({
  bars,
  budgetCents,
  color,
  label,
}: {
  bars: PeriodBar[]
  budgetCents: number | null
  color: string
  label: string
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
  const amounts = barAmounts(values, slot, settings)
  const dateLabels = new Set(axisIndices(bars.length, Math.floor((right - left) / 52)))
  const budgetText = budget !== null ? `. Budget ${money(budget)}.` : ''

  return (
    <ChartFrame
      measure={measure}
      width={width}
      height={height}
      name={label}
      description={`${bars.map((b) => `${b.label} ${money(b.cents)}`).join(', ')}${budgetText}`}
      readout={
        hovered && (
          <Readout
            x={positions[pointer.active]!}
            chartWidth={width}
            title={hovered.label}
            lines={[`${money(hovered.cents)}${hovered.current ? ' so far' : ''}`]}
          />
        )
      }
    >
      <ValueAxis ticks={axis.values} y={y} left={left} right={right} format={format} />
      {bars.map((bar, i) => (
        <path
          key={bar.label}
          d={barPath(center(i) - barWidth / 2, y(values[i]!), barWidth, bottom)}
          fill={color}
          // The running period is drawn lighter and outlined: it is still filling up.
          fillOpacity={bar.current ? 0.45 : 1}
          stroke={bar.current ? color : 'none'}
          strokeWidth="1.5"
          opacity={hovered && hovered !== bar ? 0.55 : 1}
          aria-hidden="true"
        />
      ))}
      {budget !== null && (
        <>
          <line x1={left} x2={right} y1={y(budget)} y2={y(budget)} className="chart-line budget" />
          <EndLabel x={right + 10} y={y(budget) - 6} name="Budget" value={money(budget)} />
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
                {amounts[i] || (bar.current ? compactMoney(values[i]!, settings) : '')}
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
      {values.every((v) => v === 0) && (
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
