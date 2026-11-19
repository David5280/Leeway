// Small shared building blocks: icons, switches, progress bars, notices.

import type { CSSProperties, ReactNode } from 'react'

/** The logo on the sign-in, setup and connect screens, where it stands alone above a form. */
export const AUTH_LOGO_SIZE = 44

/** Where the wheel's eight handles end, clockwise from the top. */
const WHEEL_KNOBS: [number, number][] = [
  [14, 2.4],
  [22.2, 5.8],
  [25.6, 14],
  [22.2, 22.2],
  [14, 25.6],
  [5.8, 22.2],
  [2.4, 14],
  [5.8, 5.8],
]

/**
 * Leeway's logo: a ship's wheel, since leeway is a sailing word for room to
 * spare. Drawn in the theme's ink and accent, so it follows every theme.
 * 34px sits beside the header's wordmark; the sign-in screens pass AUTH_LOGO_SIZE.
 */
export function Logo({ size = 34 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" fill="none" aria-hidden="true">
      {/* Spokes inside the rim, then the handles outside it. */}
      <path
        d="M14 11.4L14 6.6M15.84 12.16L19.23 8.77M16.6 14L21.4 14M15.84 15.84L19.23 19.23M14 16.6L14 21.4M12.16 15.84L8.77 19.23M11.4 14L6.6 14M12.16 12.16L8.77 8.77"
        stroke="var(--ink)"
        strokeWidth="1.5"
      />
      <path
        d="M14 6.6L14 2.8M19.23 8.77L21.92 6.08M21.4 14L25.2 14M19.23 19.23L21.92 21.92M14 21.4L14 25.2M8.77 19.23L6.08 21.92M6.6 14L2.8 14M8.77 8.77L6.08 6.08"
        stroke="var(--ink)"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      {WHEEL_KNOBS.map(([cx, cy]) => (
        <circle key={`${cx},${cy}`} cx={cx} cy={cy} r="1.7" fill="var(--ink)" />
      ))}
      <circle cx="14" cy="14" r="7.4" stroke="var(--ink)" strokeWidth="2.4" fill="none" />
      <circle cx="14" cy="14" r="2.9" fill="var(--accent)" />
    </svg>
  )
}

const ICONS = {
  back: <path d="M15 6l-6 6 6 6" />,
  forward: <path d="M9 6l6 6-6 6" />,
  warn: (
    <>
      <path d="M12 4l9 16H3z" />
      <path d="M12 10v4M12 17v.5" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8v.5" />
    </>
  ),
  overview: <path d="M4 13h6V4H4zM14 20h6v-9h-6zM4 20h6v-3H4zM14 7h6V4h-6z" />,
  activity: <path d="M4 7h16M4 12h16M4 17h10" />,
  accounts: (
    <>
      <rect x="3" y="6" width="18" height="13" rx="2" />
      <path d="M3 10h18M7 15h4" />
    </>
  ),
  budgets: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 4v8l6 4" />
    </>
  ),
  plan: (
    <>
      <rect x="4" y="5" width="16" height="15" rx="2" />
      <path d="M4 10h16M9 3v4M15 3v4" />
    </>
  ),
  sliders: (
    <>
      <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12" />
      <circle cx="16" cy="6" r="2" />
      <circle cx="10" cy="12" r="2" />
      <circle cx="18" cy="18" r="2" />
    </>
  ),
  up: <path d="M6 15l6-6 6 6" />,
  down: <path d="M6 9l6 6 6-6" />,
  sync: (
    <path d="M20 11a8 8 0 0 0-14.3-4.9L4 8M4 4v4h4M4 13a8 8 0 0 0 14.3 4.9L20 16M20 20v-4h-4" />
  ),
  close: <path d="M6 6l12 12M18 6L6 18" />,
  plus: <path d="M12 5v14M5 12h14" />,
}

export type IconName = keyof typeof ICONS

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {ICONS[name]}
    </svg>
  )
}

export function Dot({ color, dashed = false }: { color?: string | null; dashed?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={dashed || !color ? 'dot dashed' : 'dot'}
      style={color ? { background: color } : undefined}
    />
  )
}

export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      className="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    />
  )
}

/** About how many characters of option labels fit across a phone in one row. */
const ONE_ROW_CHARACTERS = 26

/**
 * How many columns a segmented control takes on a phone (styles.css), so its
 * options sit in even rows: all in one row when the labels fit, otherwise rows
 * of at most three, so four make two rows of two, never three and one alone.
 */
export function phoneColumns(labels: readonly string[]): number {
  const characters = labels.reduce((sum, label) => sum + label.length, 0)
  if (characters <= ONE_ROW_CHARACTERS) return labels.length
  return Math.ceil(labels.length / Math.ceil(labels.length / 3))
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T
  options: readonly { value: T; label: string }[]
  onChange: (value: T) => void
  label: string
}) {
  const style = {
    '--columns': phoneColumns(options.map((option) => option.label)),
  } as CSSProperties
  return (
    <div className="seg" role="group" aria-label={label} style={style}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

/** A labeled row in a settings list: what it is on the left, the control on the right. */
export function Setting({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <div className="setting">
      <span className="setting-label">
        {label}
        {hint && <small>{hint}</small>}
      </span>
      {children}
    </div>
  )
}

/**
 * A budget bar: how much is used, with an optional marker for where steady
 * spending would be today. `reserved` adds a striped stretch after the fill
 * for money held back but not yet spent, like a goal's share of the budget.
 */
export function Progress({
  percent,
  color = 'var(--accent)',
  marker,
  'aria-label': label,
  thick = false,
  reserved = 0,
}: {
  percent: number
  color?: string
  marker?: number | null
  /** What a screen reader calls the bar, amounts spelled out: "Groceries: $40". */
  'aria-label': string
  thick?: boolean
  reserved?: number
}) {
  const clamped = Math.max(0, Math.min(100, percent))
  const held = Math.max(0, Math.min(100 - clamped, reserved))
  return (
    <div
      className={thick ? 'track thick' : 'track'}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped)}
    >
      <div className="fill" style={{ width: `${clamped}%`, background: color }} />
      {held > 0 && (
        <div className="fill reserved" style={{ left: `${clamped}%`, width: `${held}%` }} />
      )}
      {marker !== null && marker !== undefined && (
        <div className="tick" style={{ left: `${Math.max(0, Math.min(100, marker))}%` }} />
      )}
    </div>
  )
}

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null
  const message = error instanceof Error ? error.message : 'Something went wrong.'
  return (
    <p className="notice error" role="alert">
      {message}
    </p>
  )
}

export function Loading({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="row muted" role="status">
      <span className="spinner" aria-hidden="true" />
      {label}
    </div>
  )
}

/**
 * What to show until a screen's data is in: why it could not load, or a
 * spinner while it still might. Every screen waits the same way.
 */
export function LoadingOrError({ error, label }: { error: unknown; label?: string }) {
  return error ? <ErrorNote error={error} /> : <Loading label={label} />
}

export function Card({
  children,
  className = '',
  label,
  style,
}: {
  children: ReactNode
  className?: string
  label?: string
  style?: CSSProperties
}) {
  return (
    <section className={`card ${className}`} aria-label={label} style={style}>
      {children}
    </section>
  )
}
