// Small SVG charts: the spending pace line and per-period bars.

import type { Output } from '../api/client'
import { useApp } from '../lib/app'
import { shortDate } from '../lib/format'

/** A round axis maximum: 1, 2, 2.5 or 5 times a power of ten, in cents. */
export function niceMax(cents: number): number {
  if (cents <= 0) return 10_000
  const magnitude = 10 ** Math.floor(Math.log10(cents))
  const step = [1, 2, 2.5, 5, 10].find((s) => s * magnitude >= cents)!
  return step * magnitude
}

function compact(cents: number, currency: string, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(cents / 100)
}

/**
 * Running total of flexible spending against an even pace, with where the
 * current rate would land by the end of the period.
 */
export function PaceChart({ pace }: { pace: Output<'get_spending_pace'> }) {
  const { settings, money } = useApp()
  // The SVG is drawn on a fixed 640 by 230 canvas and scales to fit; the
  // plot area sits inside it, leaving room for the axis labels.
  const W = 640
  const H = 230
  const left = 44
  const right = 620
  const top = 20
  const bottom = 190
  const spent = pace.cumulative.at(-1)?.cents ?? 0
  // 5% headroom so the highest line never touches the top edge.
  const max = niceMax(Math.max(pace.budgetCents, pace.projectedCents, spent) * 1.05)
  const x = (day: number) => left + ((right - left) * day) / Math.max(1, pace.days - 1)
  const y = (cents: number) => bottom - ((bottom - top) * cents) / max
  const points = pace.cumulative.map(
    (point, i) => `${x(i).toFixed(1)} ${y(point.cents).toFixed(1)}`,
  )
  const lastIndex = pace.cumulative.length - 1
  // Data that stops before the last day means the period is still running.
  const isCurrent = lastIndex < pace.days - 1
  const grid = [0, 0.25, 0.5, 0.75, 1].map((share) => share * max)
  const summary = `Flexible spending: ${money(spent)} by ${shortDate(pace.cumulative.at(-1)?.date ?? pace.start, settings.locale)} against a ${money(pace.budgetCents)} budget, on track for ${money(pace.projectedCents)}.`

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={summary}
      style={{ width: '100%', height: 'auto', overflow: 'visible' }}
    >
      <g stroke="var(--line)" strokeWidth="1">
        {grid.map((value) => (
          <line key={value} x1={left} x2={right} y1={y(value)} y2={y(value)} />
        ))}
      </g>
      <g fill="var(--muted)" fontSize="11" fontFamily="var(--font-num)" textAnchor="end">
        {grid.map((value) => (
          <text key={value} x={left - 8} y={y(value) + 4}>
            {compact(value, settings.currency, settings.locale)}
          </text>
        ))}
      </g>
      <g fill="var(--muted)" fontSize="11" fontFamily="var(--font-num)" textAnchor="middle">
        <text x={left} y={H - 20}>
          {shortDate(pace.start, settings.locale)}
        </text>
        {/* "Today" only where it cannot run into the start or end date. */}
        {isCurrent && lastIndex > 2 && lastIndex < pace.days - 3 && (
          <text x={x(lastIndex)} y={H - 20}>
            Today
          </text>
        )}
        <text x={right} y={H - 20}>
          {shortDate(pace.end, settings.locale)}
        </text>
      </g>
      {pace.budgetCents > 0 && (
        <>
          <line
            x1={left}
            x2={right}
            y1={y(pace.budgetCents)}
            y2={y(pace.budgetCents)}
            stroke="var(--over)"
            strokeWidth="1.5"
            strokeDasharray="2 4"
          />
          <text x={left + 4} y={y(pace.budgetCents) - 6} fill="var(--muted)" fontSize="11">
            Budget {money(pace.budgetCents)}
          </text>
          <path
            d={`M${x(0)} ${y(0)} L${x(pace.days - 1)} ${y(pace.budgetCents)}`}
            stroke="var(--muted)"
            strokeWidth="2"
            strokeDasharray="6 6"
            fill="none"
          />
        </>
      )}
      {isCurrent && lastIndex >= 0 && (
        <path
          d={`M${x(lastIndex)} ${y(spent)} L${x(pace.days - 1)} ${y(pace.projectedCents)}`}
          stroke="var(--accent)"
          strokeWidth="2"
          strokeDasharray="1 5"
          strokeLinecap="round"
          fill="none"
        />
      )}
      {points.length > 0 && (
        <path
          d={`M${points.join(' L')}`}
          stroke="var(--accent)"
          strokeWidth="2"
          fill="none"
          strokeLinejoin="round"
        />
      )}
      {lastIndex >= 0 && (
        <>
          <circle
            cx={x(lastIndex)}
            cy={y(spent)}
            r="5"
            fill="var(--accent)"
            stroke="var(--surface)"
            strokeWidth="2"
          />
          <text
            x={Math.min(x(lastIndex) + 12, right - 40)}
            y={y(spent) + 4}
            fill="var(--ink)"
            fontSize="12"
            fontWeight="600"
            fontFamily="var(--font-num)"
          >
            {money(spent)}
          </text>
        </>
      )}
    </svg>
  )
}

/** Bars per period for one category, with its budget as a dashed line. */
export function PeriodBars({
  bars,
  budgetCents,
  color,
  label,
}: {
  bars: { label: string; cents: number; current: boolean }[]
  budgetCents: number | null
  color: string
  label: string
}) {
  const { money } = useApp()
  const W = 540
  const H = 200
  const left = 36
  const right = 520
  const top = 24
  const bottom = 170
  const max = niceMax(Math.max(budgetCents ?? 0, ...bars.map((b) => b.cents), 1) * 1.1)
  // A period with net refunds draws as an empty bar rather than below the axis.
  const y = (cents: number) => bottom - ((bottom - top) * Math.max(0, cents)) / max
  // Each bar gets an equal slot and fills at most 60% of it.
  const slot = (right - left) / Math.max(1, bars.length)
  const width = Math.min(48, slot * 0.6)
  const description = `${label}: ${bars.map((b) => `${b.label} ${money(b.cents)}`).join(', ')}${budgetCents !== null ? `. Budget ${money(budgetCents)}.` : ''}`

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={description}
      style={{ width: '100%', height: 'auto' }}
    >
      <line x1={left} x2={right} y1={bottom} y2={bottom} stroke="var(--muted)" strokeOpacity=".5" />
      {budgetCents !== null && budgetCents > 0 && (
        <>
          <line
            x1={left}
            x2={right}
            y1={y(budgetCents)}
            y2={y(budgetCents)}
            stroke="var(--muted)"
            strokeWidth="1.5"
            strokeDasharray="2 4"
          />
          <text x={right} y={y(budgetCents) - 6} textAnchor="end" fill="var(--muted)" fontSize="11">
            Budget {money(budgetCents)}
          </text>
        </>
      )}
      {bars.map((bar, i) => {
        const cx = left + slot * i + slot / 2
        return (
          <g key={bar.label}>
            <rect
              x={cx - width / 2}
              y={y(bar.cents)}
              width={width}
              height={bottom - y(bar.cents)}
              rx="4"
              fill={color}
              // The current period is still filling up, so it is drawn lighter.
              fillOpacity={bar.current ? 0.5 : 1}
            />
            {bar.current && (
              <text
                x={cx}
                y={y(bar.cents) - 8}
                textAnchor="middle"
                fill="var(--ink)"
                fontSize="12"
                fontWeight="600"
                fontFamily="var(--font-num)"
              >
                {money(bar.cents)}
              </text>
            )}
            <text x={cx} y={H - 12} textAnchor="middle" fill="var(--muted)" fontSize="11">
              {bar.label}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
