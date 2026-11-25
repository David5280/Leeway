// Compare accounts' bar: how many accounts are ticked and what they come to
// together, and a button that opens the math behind that total. It rides
// above the tab bar while the cards scroll under it, and comes to rest after
// the last card, clear of the tab bar.

import { useState } from 'react'
import type { Account } from '../../api/client'
import { DrillSheet } from '../../components/design/DrillSheet'
import { Money } from '../../components/design/Money'
import { combine } from '../../lib/accountCards'
import { selectionDrill } from '../../lib/drills/accounts'

export function SelectBar({ picked }: { picked: readonly Account[] }) {
  const [open, setOpen] = useState(false)
  const count = picked.length
  return (
    <div className="select-bar" role="region" aria-label="Picked accounts">
      <span className="select-bar-total" aria-live="polite">
        {count === 0 ? (
          'Tick the accounts to add up'
        ) : (
          <>
            <span className="small muted">
              {count} {count === 1 ? 'account' : 'accounts'} together
            </span>
            <Money cents={combine(picked).netCents} precision="cents" className="strong" />
          </>
        )}
      </span>
      {count > 0 && (
        <span className="select-bar-actions">
          <button type="button" className="btn" onClick={() => setOpen(true)}>
            How it adds up
          </button>
        </span>
      )}
      {open && <DrillSheet drill={selectionDrill(picked)} onClose={() => setOpen(false)} />}
    </div>
  )
}
