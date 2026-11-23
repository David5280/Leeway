// Small shared building blocks: icons, switches, progress bars, notices.

import type { CSSProperties, ReactNode } from 'react'
import { ICONS, type IconName } from './icons'

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

export type { IconName }

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
  /** An option marked disabled shows but cannot be picked, like a range with nothing more to show. */
  options: readonly { value: T; label: string; disabled?: boolean }[]
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
          disabled={option.disabled}
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
  hintId,
  children,
}: {
  label: string
  hint?: string
  /** The hint's id, for the control to name with aria-describedby so a screen reader reads it. */
  hintId?: string
  children: ReactNode
}) {
  return (
    <div className="setting">
      <span className="setting-label">
        {label}
        {hint && <small id={hintId}>{hint}</small>}
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

/**
 * Why something could not load, with a way to ask for it again. onRetry gets
 * the button pressed, which may be gone once the retry starts, so the caller
 * can tell where focus should go next.
 */
export function RetryNote({
  error,
  onRetry,
}: {
  error: unknown
  onRetry: (button: HTMLButtonElement) => void
}) {
  if (!error) return null
  return (
    <div className="stack-sm">
      <ErrorNote error={error} />
      <div className="row">
        <button type="button" className="btn" onClick={(e) => onRetry(e.currentTarget)}>
          Try again
        </button>
      </div>
    </div>
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
