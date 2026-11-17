// A line over time, used for net worth. Can go below zero, unlike the spending charts.

import { useApp } from '../lib/app'
import { shortDate } from '../lib/format'
import { niceMax } from './charts'

export interface LinePoint {
  date: string
  cents: number
}

const DAY_MS = 86_400_000
const dayNumber = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / DAY_MS

/** Axis bounds that include zero and every value, rounded outward to tidy numbers. */
export function niceRange(values: number[]): [number, number] {
  const low = Math.min(0, ...values)
  const high = Math.max(0, ...values)
  return [low < 0 ? -niceMax(-low) : 0, high > 0 || low === 0 ? niceMax(high) : 0]
}

/**
 * Points are placed by date, so a gap of a month looks like one. Compact draws
 * the line alone, for a dashboard widget.
 */
export function LineChart({
  points,
  label,
  compact = false,
}: {
  points: LinePoint[]
  label: string
  compact?: boolean
}) {
  const { money, settings } = useApp()
  const W = 640
  const H = compact ? 90 : 220
  const left = compact ? 4 : 56
  const right = W - 4
  const top = 10
  const bottom = compact ? H - 6 : H - 30
  const [low, high] = niceRange(points.map((p) => p.cents))
  const first = dayNumber(points[0]?.date ?? '2000-01-01')
  const span = Math.max(1, dayNumber(points.at(-1)?.date ?? '2000-01-01') - first)
  const x = (date: string) => left + ((right - left) * (dayNumber(date) - first)) / span
  const y = (cents: number) => bottom - ((bottom - top) * (cents - low)) / (high - low)
  const path = points.map((p) => `${x(p.date).toFixed(1)} ${y(p.cents).toFixed(1)}`).join(' L')
  const last = points.at(-1)

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={label}
      style={{ width: '100%', height: 'auto', overflow: 'visible' }}
    >
      {!compact && (
        <g fill="var(--muted)" fontSize="11" fontFamily="var(--font-num)">
          {[low, high].map((value) => (
            <g key={value}>
              <line x1={left} x2={right} y1={y(value)} y2={y(value)} stroke="var(--line)" />
              <text x={left - 8} y={y(value) + 4} textAnchor="end">
                {money(value)}
              </text>
            </g>
          ))}
          {low < 0 && (
            <line
              x1={left}
              x2={right}
              y1={y(0)}
              y2={y(0)}
              stroke="var(--muted)"
              strokeDasharray="2 4"
            />
          )}
          {points.length > 1 && (
            <>
              <text x={left} y={H - 8}>
                {shortDate(points[0]!.date, settings.locale)}
              </text>
              <text x={right} y={H - 8} textAnchor="end">
                {shortDate(last!.date, settings.locale)}
              </text>
            </>
          )}
        </g>
      )}
      {points.length > 1 && (
        <path
          d={`M${path}`}
          stroke="var(--accent)"
          strokeWidth="2"
          fill="none"
          strokeLinejoin="round"
        />
      )}
      {last && (
        <circle
          cx={x(last.date)}
          cy={y(last.cents)}
          r="4"
          fill="var(--accent)"
          stroke="var(--surface)"
          strokeWidth="2"
        />
      )}
    </svg>
  )
}
