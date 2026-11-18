// A card holding a form, brought into view when it opens, since the button that
// opened it may be far down the screen.

import { useEffect, useRef, type ReactNode } from 'react'

export function FormCard({ title, children }: { title: string; children: ReactNode }) {
  const ref = useRef<HTMLElement>(null)
  useEffect(() => {
    ref.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
  }, [])
  return (
    <section ref={ref} className="card stack" aria-label={title}>
      <h2>{title}</h2>
      {children}
    </section>
  )
}
