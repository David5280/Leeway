// Small shared building blocks: icons, switches, progress bars, notices.

import type { CSSProperties, ReactNode } from 'react'

export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" fill="none" aria-hidden="true">
      <path d="M14 3 L14 21 L4 21 Z" fill="var(--accent)" />
      <path d="M17 8 L24 21 L17 21 Z" fill="var(--ink)" opacity=".85" />
      <path d="M3 24 H25" stroke="var(--ink)" strokeWidth="2" strokeLinecap="round" />
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
  customize: (
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
  return (
    <div className="seg" role="group" aria-label={label}>
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
  label,
  thick = false,
  reserved = 0,
}: {
  percent: number
  color?: string
  marker?: number | null
  label: string
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
