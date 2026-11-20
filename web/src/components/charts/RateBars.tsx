// The share of pay saved each month, a bar a month, against a dashed level:
// the owner's own target, or the usual month when they set none. Green only
// marks a month that reached their target, and nothing is ever red, since
// payroll deductions Leeway cannot see may make up the rest. A month with no
// rate has no bar and reads "Not known". A month over 100% (more moved to
// savings than came in as pay) stops at the top with its real figure written
// over it, so one odd month does not flatten the rest. Tap a month for its
// numbers.

import { useApp } from '../../lib/app'
import { axisIndices, niceTicks, textWidth, RUNNING_FILL_OPACITY } from '../../lib/chartScale'
import { monthYear } from '../../lib/format'
import { reachedTarget, type MonthRate } from '../../lib/rates'
import { useWidth } from '../../lib/useWidth'
import { Money } from '../design/Money'
import { monthLabel } from './FlowBars'
import { ChartFrame, EndLabel, PointerLayer, Readout, usePointer, ValueAxis } from './parts'
import { barLayout, barPath } from './PeriodBars'

const percentText = (value: number) => `${value}%`

/** The tallest a bar is drawn: all of pay. */
const FULL = 100

export function RateBars({
  months,
  level,
  targetPercent,
  label,
}: {
  months: MonthRate[]
  /** The dashed level: the owner's target, or the usual month; null leaves it out. */
  level: { percent: number; label: string } | null
  targetPercent: number | null
  label: string
}) {
  const { settings } = useApp()
  const [measure, width] = useWidth<HTMLDivElement>(540)
  const values = months.map((month) => Math.min(FULL, month.percent ?? 0))
  const axis = niceTicks(0, Math.min(FULL, Math.max(level?.percent ?? 0, 10, ...values) * 1.1), 4)
  const layout = barLayout(
    months.length,
    width,
    axis.values.map(percentText),
    level ? percentText(level.percent) : '',
  )
  const { height, left, right, top, bottom, slot, barWidth } = layout
  const y = (percent: number) => bottom - ((bottom - top) * Math.max(0, percent)) / axis.high
  const center = (i: number) => left + slot * i + slot / 2
  const positions = months.map((_, i) => center(i))
  const pointer = usePointer(positions, width)
  const hovered = months[pointer.active]
  const labels = months.map((month) => monthLabel(month.start, settings.locale))
  const labelRoom = Math.max(0, ...labels.map((text) => textWidth(text))) + 12
  const shown = new Set(
    axisIndices(months.length, Math.floor((right - left) / labelRoom), labelRoom / slot),
  )

  return (
    <ChartFrame
      measure={measure}
      width={width}
      height={height}
      name={label}
      description={describeRates(months, level, settings.locale)}
      readout={
        hovered && (
          <Readout
            x={positions[pointer.active]!}
            chartWidth={width}
            title={monthYear(hovered.start, settings.locale)}
            lines={rateLines(hovered)}
          />
        )
      }
    >
      <ValueAxis ticks={axis.values} y={y} left={left} right={right} format={percentText} />
      {months.map((month, i) => {
        if (month.percent === null) return null
        const fill = reachedTarget(month, targetPercent) ? 'var(--tone-in)' : 'var(--tone-muted)'
        const capped = month.percent > FULL
        return (
          <g key={month.start} aria-hidden="true" opacity={hovered && hovered !== month ? 0.55 : 1}>
            <path
              d={barPath(
                center(i) - barWidth / 2,
                y(Math.min(FULL, month.percent)),
                barWidth,
                bottom,
              )}
              fill={fill}
              // The running month is lighter and outlined: it is still filling up.
              fillOpacity={month.current ? RUNNING_FILL_OPACITY : 1}
              stroke={month.current ? fill : 'none'}
              strokeWidth={1.5}
            />
            {capped && (
              <text
                x={center(i)}
                y={y(FULL) - 6}
                textAnchor="middle"
                className="chart-axis strong-label"
              >
                {percentText(month.percent)}
              </text>
            )}
          </g>
        )
      })}
      {level && (
        <>
          <line
            x1={left}
            x2={right}
            y1={y(level.percent)}
            y2={y(level.percent)}
            className="chart-line budget"
          />
          <EndLabel
            x={right + 10}
            y={y(level.percent) - 6}
            name={level.label}
            value={percentText(level.percent)}
          />
        </>
      )}
      <g aria-hidden="true">
        {months.map(
          (month, i) =>
            shown.has(i) && (
              <text
                key={month.start}
                x={center(i)}
                y={height - 8}
                textAnchor="middle"
                className={month.current ? 'chart-axis strong-label' : 'chart-axis'}
              >
                {labels[i]}
              </text>
            ),
        )}
      </g>
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

/** A tapped month in words: its rate and the money behind it, or why it has none. */
function rateLines(month: MonthRate) {
  if (month.percent === null) return ['Not known yet: no pay or saving seen']
  return [
    `${month.percent}% of pay saved${month.current ? ' so far' : ''}`,
    <>
      <Money cents={month.savedCents} /> of <Money cents={month.payCents} />
    </>,
  ]
}

/** The chart in one sentence per month, for screen readers. */
export function describeRates(
  months: MonthRate[],
  level: { percent: number; label: string } | null,
  locale: string,
): string {
  const each = months
    .map(
      (month) =>
        `${monthYear(month.start, locale)}: ${month.percent === null ? 'not known' : `${month.percent}%`}`,
    )
    .join('. ')
  return level === null ? `${each}.` : `${each}. ${level.label}: ${level.percent}%.`
}
