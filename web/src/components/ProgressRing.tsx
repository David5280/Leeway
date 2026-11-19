// A ring that fills clockwise with how much of something is used, with a
// short figure in the middle. Read out as a progress bar.

import type { ReactNode } from 'react'

const STROKE = 8

export function ProgressRing({
  percent,
  label,
  color = 'var(--accent)',
  size = 76,
  children,
}: {
  /** From 0 to 100; anything outside is held to the ends. */
  percent: number
  label: string
  color?: string
  size?: number
  /** What the middle says, like "42%". */
  children?: ReactNode
}) {
  const clamped = Math.max(0, Math.min(100, percent))
  const radius = (size - STROKE) / 2
  const around = 2 * Math.PI * radius
  return (
    <div
      className="ring"
      style={{ width: size, height: size }}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped)}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--track)"
          strokeWidth={STROKE}
        />
        <circle
          className="ring-fill"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={STROKE}
          strokeLinecap={clamped > 0 ? 'round' : 'butt'}
          strokeDasharray={around}
          strokeDashoffset={around * (1 - clamped / 100)}
          // Start at twelve o'clock.
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      {children !== undefined && <span className="ring-text">{children}</span>}
    </div>
  )
}
