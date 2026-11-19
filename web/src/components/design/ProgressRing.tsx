// A ring that fills as a budget is used or a goal is reached, with the
// percent in its middle: the round partner to the Progress bar (ui.tsx).
// Its tone follows the status: on track, close to the limit, or over.

import type { Status } from './StatusPill'

/** The ring's circle, on a 40 unit box: radius 17, so a 3 unit stroke stays inside. */
const RADIUS = 17
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

export function ProgressRing({
  percent,
  label,
  status = 'ok',
  size = 44,
}: {
  /** How full, from 0; past 100 the ring stays full and the number says how far over. */
  percent: number
  /** What it measures, for screen readers: "Groceries budget used". */
  label: string
  status?: Status
  size?: number
}) {
  const shown = Math.round(Math.max(0, percent))
  const filled = Math.min(100, shown) / 100
  return (
    <span
      className={`ring ring-${status}`}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.min(100, shown)}
      aria-valuetext={`${shown}%`}
      style={{ width: size, height: size }}
    >
      <svg viewBox="0 0 40 40" aria-hidden="true">
        <circle className="ring-track" cx="20" cy="20" r={RADIUS} />
        <circle
          className="ring-fill"
          cx="20"
          cy="20"
          r={RADIUS}
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={CIRCUMFERENCE * (1 - filled)}
        />
      </svg>
      <span className="ring-label">{shown}%</span>
    </span>
  )
}
