// The frame each Customize section sits in, and the hook sections save through.

import type { ReactNode } from 'react'
import type { Settings } from '../../api/client'
import { useUpdateSettings } from '../../api/settings'

type Appearance = Settings['appearance']

export function Section({
  id,
  title,
  hint,
  children,
}: {
  id: string
  title: string
  hint?: string
  children: ReactNode
}) {
  return (
    <section
      id={id}
      className="card stack"
      aria-labelledby={`${id}-title`}
      style={{ scrollMarginTop: 24 }}
    >
      <div>
        <h2 id={`${id}-title`}>{title}</h2>
        {hint && <span className="small muted">{hint}</span>}
      </div>
      {children}
    </section>
  )
}

/** Saves settings optimistically, so every change previews live. */
export function useSave() {
  const update = useUpdateSettings()
  return {
    appearance: (change: Partial<Appearance>) => update.mutate({ appearance: change }),
    settings: (change: Parameters<typeof update.mutate>[0]) => update.mutate(change),
  }
}
