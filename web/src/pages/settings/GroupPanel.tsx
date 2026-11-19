// One Settings group: its heading, its one-line description, and its sections.

import { useEffect, useRef } from 'react'
import type { SettingsGroup } from './groups'
import { SectionTitlesShown } from './Section'

export function GroupPanel({ group }: { group: SettingsGroup }) {
  const heading = useRef<HTMLDivElement>(null)

  // Switching groups from far down a long one would otherwise open the new
  // group partway down; this brings its heading back into view if it is not.
  useEffect(() => {
    heading.current?.scrollIntoView({ block: 'nearest' })
  }, [group.id])

  return (
    <div className="stack settings-panel">
      {/* A div, not a header: outside a landmark, a header is the page's banner. */}
      <div ref={heading} className="settings-head">
        <h2>{group.title}</h2>
        <p className="muted">{group.description}</p>
      </div>
      <SectionTitlesShown.Provider value={group.sections.length > 1}>
        {group.sections.map((Section, index) => (
          // A group's sections never change order while it is open.
          <Section key={index} />
        ))}
      </SectionTitlesShown.Provider>
    </div>
  )
}
