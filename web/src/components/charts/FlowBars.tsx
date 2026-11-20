// Money in beside money out for each month: a green bar for what came in and
// a plain one for what went out, red only for a finished month where more
// went out than came in. A dashed line marks the usual month's spending, so
// each month reads against where it should be. Tap a month for its numbers.

import { useApp } from '../../lib/app'
import { axisFormat, axisIndices, niceTicks, textWidth } from '../../lib/chartScale'
import { overspent, type FlowMonth } from '../../lib/flows'
import { monthYear } from '../../lib/format'
import { useWidth } from '../../lib/useWidth'
import { Money } from '../design/Money'
import { ChartFrame, EndLabel, PointerLayer, Readout, usePointer, ValueAxis } from './parts'
import { barLayout, barPath } from './PeriodBars'

/** "Oct", the month alone, for the axis under each pair of bars. */
export function monthLabel(start: string, locale: string): string {
  return new Date(`${start}T00:00:00Z`).toLocaleDateString(locale, {
    month: 'short',
    timeZone: 'UTC',
  })
}

/** Each pair's bar width and the gap between its two bars, inside one month's slot. */
export function pairWidths(slot: number): { bar: number; gap: number } {
  const gap = Math.max(2, Math.min(4, slot * 0.06))
  return { bar: Math.max(3, Math.min(22, (slot * 0.7 - gap) / 2)), gap }
}

export function FlowBars({
  months,
  usualSpentCents,
  label,
}: {
  months: FlowMonth[]
  /** The usual month's spending, drawn as a dashed level; null leaves it out. */
  usualSpentCents: number | null
  label: string
}) {
  const { settings, money } = useApp()
  const [measure, width] = useWidth<HTMLDivElement>(540)
  // Net refunds draw as an empty bar, never below the axis.
  const values = months.flatMap((month) => [
    Math.max(0, month.incomeCents),
    Math.max(0, month.spentCents),
  ])
  const usual = usualSpentCents !== null && usualSpentCents > 0 ? usualSpentCents : null
  const axis = niceTicks(0, Math.max(usual ?? 0, ...values) * 1.08, 4)
  const format = axisFormat(axis.values, settings)
  const layout = barLayout(
    months.length,
    width,
    axis.values.map(format),
    usual === null ? '' : money(usual),
  )
  const { height, left, right, top, bottom, slot } = layout
  const { bar, gap } = pairWidths(slot)
  const y = (cents: number) => bottom - ((bottom - top) * Math.max(0, cents)) / axis.high
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
      description={describeFlows(months, usual, money, settings.locale)}
      readout={
        hovered && (
          <Readout
            x={positions[pointer.active]!}
            chartWidth={width}
            title={monthYear(hovered.start, settings.locale)}
            lines={[
              <>
                <Money cents={hovered.incomeCents} /> in
              </>,
              <>
                <Money cents={hovered.spentCents} /> out
                {hovered.current ? ' so far' : ''}
              </>,
              <>
                {hovered.keptCents < 0 ? 'Short ' : 'Kept '}
                <Money cents={Math.abs(hovered.keptCents)} />
              </>,
            ]}
          />
        )
      }
    >
      <ValueAxis ticks={axis.values} y={y} left={left} right={right} format={format} />
      {months.map((month, i) => {
        const dim = hovered && hovered !== month ? 0.55 : 1
        // The running month is drawn lighter and outlined: it is still filling up.
        const running = month.current ? { fillOpacity: 0.45, strokeWidth: 1.5 } : {}
        const out = overspent(month) ? 'var(--tone-problem)' : 'var(--tone-muted)'
        return (
          <g key={month.start} opacity={dim} aria-hidden="true">
            <path
              d={barPath(center(i) - gap / 2 - bar, y(month.incomeCents), bar, bottom)}
              fill="var(--tone-in)"
              stroke={month.current ? 'var(--tone-in)' : 'none'}
              {...running}
            />
            <path
              d={barPath(center(i) + gap / 2, y(month.spentCents), bar, bottom)}
              fill={out}
              stroke={month.current ? out : 'none'}
              {...running}
            />
          </g>
        )
      })}
      {usual !== null && (
        <>
          <line x1={left} x2={right} y1={y(usual)} y2={y(usual)} className="chart-line budget" />
          <EndLabel
            x={right + 10}
            y={y(usual) - 6}
            name="Usual out"
            value={<Money as="tspan" cents={usual} />}
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
      {values.every((value) => value === 0) && (
        <text
          x={(left + right) / 2}
          y={(top + bottom) / 2}
          textAnchor="middle"
          className="chart-axis"
        >
          Nothing in or out yet
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

/** The chart in one sentence per month, for screen readers. */
export function describeFlows(
  months: FlowMonth[],
  usual: number | null,
  money: (cents: number) => string,
  locale: string,
): string {
  const each = months
    .map(
      (m) =>
        `${monthYear(m.start, locale)}: ${money(m.incomeCents)} in, ${money(m.spentCents)} out`,
    )
    .join('. ')
  return usual === null ? `${each}.` : `${each}. A usual month's spending is ${money(usual)}.`
}
