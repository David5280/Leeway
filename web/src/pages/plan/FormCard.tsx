// A card holding a form, brought into view when it opens, since the button that
// opened it may be far down the screen. One that replaces another step of the
// same task can take focus to its heading, so a screen reader hears where it is.

import { useEffect, useRef, type ReactNode } from 'react'

export function FormCard({
  title,
  focusHeading = false,
  children,
}: {
  title: string
  /** Moves focus to the heading when the card opens, as the next step of a task. */
  focusHeading?: boolean
  children: ReactNode
}) {
  const ref = useRef<HTMLElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    ref.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
    if (focusHeading) heading.current?.focus()
  }, [focusHeading])
  return (
    <section ref={ref} className="card stack" aria-label={title}>
      {/* Focusable only from code (tabIndex -1), so tabbing still skips it. */}
      <h2 ref={heading} tabIndex={focusHeading ? -1 : undefined}>
        {title}
      </h2>
      {children}
    </section>
  )
}
