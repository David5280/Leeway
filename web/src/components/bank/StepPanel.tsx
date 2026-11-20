// The inset panel each step of adding a bank shows in.

import { useEffect, useRef, type ReactNode } from 'react'

/**
 * A titled panel that takes focus when it opens, so a screen reader reads the
 * new step and a keyboard carries on from it rather than from a button that
 * has just gone.
 */
export function StepPanel({ title, children }: { title: string; children: ReactNode }) {
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => heading.current?.focus(), [title])
  return (
    <section className="bank-step stack-sm" aria-label={title}>
      <h4 ref={heading} tabIndex={-1} className="bank-step-title">
        {title}
      </h4>
      {children}
    </section>
  )
}
