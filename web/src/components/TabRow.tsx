// A page's sections as one row of segments across the page, under its title.
// Where they do not all fit, as on a phone, the row scrolls sideways instead
// of wrapping, and the section shown is always scrolled into view.

import { useEffect, useRef } from 'react'

export function TabRow<T extends string>({
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
  const row = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const pressed = row.current?.querySelector<HTMLElement>('[aria-pressed="true"]')
    // Nearest only: a section already in view stays put, and the page never jumps.
    pressed?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [value])
  return (
    <div ref={row} className="seg seg-scroll" role="group" aria-label={label}>
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
