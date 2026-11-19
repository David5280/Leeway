// The card each Settings section sits in, and the hook sections save through.

import { createContext, useContext, type ReactNode } from 'react'
import type { Settings } from '../../api/client'
import { useUpdateSettings } from '../../api/settings'

type Appearance = Settings['appearance']

/**
 * Whether section cards show their own titles. A group with one section turns
 * them off, since the group's heading above already says what the card is.
 */
export const SectionTitlesShown = createContext(true)

export function Section({
  id,
  title,
  hint,
  children,
}: {
  /** The section's anchor, so an address like /settings/budgeting#region scrolls to it. */
  id: string
  /** Shown as the card's heading, or only read out when the group's heading names it. */
  title: string
  hint?: string
  children: ReactNode
}) {
  const titled = useContext(SectionTitlesShown)
  return (
    <section
      id={id}
      className="card stack"
      aria-labelledby={titled ? `${id}-title` : undefined}
      aria-label={titled ? undefined : title}
      style={{ scrollMarginTop: 24 }}
    >
      {(titled || hint) && (
        <div>
          {titled && (
            <h3 id={`${id}-title`} className="section-title">
              {title}
            </h3>
          )}
          {hint && <span className="small muted">{hint}</span>}
        </div>
      )}
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
