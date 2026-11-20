// A ring that fills as a budget is used or a goal is reached, with the
// percent in its middle: the round partner to the Progress bar (ui.tsx).
// Its tone follows the status: on track, close to the limit, or over. An
// optional tick on the rim marks how far through the period today is, so
// spending ahead of the calendar shows as fill past the tick.

import type { Status } from './StatusPill'

/** The ring's circle, on a 40 unit box: radius 17, so a 3 unit stroke stays inside. */
const RADIUS = 17
const CIRCUMFERENCE = 2 * Math.PI * RADIUS
/** The tick crosses the 3 unit stroke with a little to spare on each side. */
const TICK_FROM = 14
const TICK_TO = 20

export function ProgressRing({
  percent,
  label,
  status = 'ok',
  size = 44,
  marker = null,
}: {
  /** How full, from 0; past 100 the ring stays full and the number says how far over. */
  percent: number
  /** What it measures, for screen readers: "Groceries budget used". */
  label: string
  status?: Status
  size?: number
  /** Where on the rim to put the tick, as a percent of the way round; none when null. */
  marker?: number | null
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
          // Where the fill animates in from: empty (styles/motion.css).
          style={{ ['--ring-empty' as string]: CIRCUMFERENCE }}
        />
        {marker !== null && <RimTick percent={marker} />}
      </svg>
      <span className="ring-label">{shown}%</span>
    </span>
  )
}

/**
 * A short line across the rim, this far round from the top. The svg is turned
 * a quarter back (design.css), so the angle is measured from its right side.
 */
function RimTick({ percent }: { percent: number }) {
  const angle = (Math.max(0, Math.min(100, percent)) / 100) * 2 * Math.PI
  const at = (radius: number) => ({
    x: 20 + radius * Math.cos(angle),
    y: 20 + radius * Math.sin(angle),
  })
  const from = at(TICK_FROM)
  const to = at(TICK_TO)
  return <line className="ring-tick" x1={from.x} y1={from.y} x2={to.x} y2={to.y} />
}
