// A change in a few characters: an arrow and a percent, "▲ 12%". Whether up
// is good depends on what is measured (savings up is good, spending up is
// not), so the caller says which; the arrow carries the direction, so the
// tone is never the only signal.

export function trendPercent(current: number, previous: number): number | null {
  if (previous === 0) return null
  return Math.round(((current - previous) / Math.abs(previous)) * 100)
}

/** flat when nothing moved, else good or bad by which way was hoped for. */
function toneOf(flat: boolean, hoped: boolean): 'flat' | 'good' | 'bad' {
  if (flat) return 'flat'
  return hoped ? 'good' : 'bad'
}

export function Trend({
  current,
  previous,
  goodWhen,
  label,
}: {
  current: number
  previous: number
  /** Which way is good news: `down` for spending, `up` for savings. */
  goodWhen: 'up' | 'down'
  /** What changed, for screen readers: "Spending compared with last month". */
  label: string
}) {
  const change = trendPercent(current, previous)
  if (change === null) return null
  const direction = Math.sign(change)
  const word = direction > 0 ? 'up' : 'down'
  const flat = direction === 0
  const tone = toneOf(flat, word === goodWhen)
  const arrow = direction > 0 ? '▲' : '▼'
  return (
    <span
      className={`trend trend-${tone}`}
      role="img"
      aria-label={flat ? `${label}: no change` : `${label}: ${word} ${Math.abs(change)}%`}
    >
      {flat ? '=' : arrow} {Math.abs(change)}%
    </span>
  )
}
