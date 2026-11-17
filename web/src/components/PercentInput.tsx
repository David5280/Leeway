// A box for a whole percent from 1 to 100.

import { useState } from 'react'

/** Reads typed text as a whole percent from 1 to 100, or null when it is not a number. */
export function parsePercent(text: string): number | null {
  const trimmed = text.trim()
  if (trimmed === '') return null
  const value = Number(trimmed)
  if (!Number.isFinite(value)) return null
  return Math.min(100, Math.max(1, Math.round(value)))
}

/**
 * Typing stays free (clearing the box to type a new number never snaps it to
 * 1); each usable number is passed on as typed, tidied into range, and the box
 * shows the saved value again when it loses focus. With `optional`, an empty
 * box means "no value" (null).
 */
export function PercentInput({
  value,
  onChange,
  label,
  placeholder,
  optional = false,
}: {
  value: number | null
  onChange: (value: number | null) => void
  label: string
  placeholder?: string
  optional?: boolean
}) {
  const [text, setText] = useState(value === null ? '' : String(value))

  function change(next: string) {
    setText(next)
    const parsed = parsePercent(next)
    if (parsed !== null) onChange(parsed)
    else if (optional && next.trim() === '') onChange(null)
  }

  return (
    <input
      className="input num"
      style={{ width: 80 }}
      type="number"
      min={1}
      max={100}
      placeholder={placeholder}
      aria-label={label}
      value={text}
      onChange={(e) => change(e.target.value)}
      onBlur={() => setText(value === null ? '' : String(value))}
    />
  )
}
