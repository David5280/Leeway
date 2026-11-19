// The amount a single charge must reach to count as large. Typed in whole
// units, saved when the box is left; an amount outside the allowed range goes
// back to the saved one. Its owner keys it by the saved amount, so a save
// made elsewhere shows here too.

import { useState } from 'react'
import { parseMoney } from '../../../lib/format'
import { LIMITS } from '../../../../../server/src/domain/notifications/settings'

/** The amount as typed in the box: whole units, without a currency sign. */
function asTyped(cents: number): string {
  return String(cents / 100)
}

/** The cents to save from what was typed, or null to put the saved amount back. */
export function chargeCents(text: string): number | null {
  const cents = parseMoney(text)
  if (cents === null) return null
  const { min, max } = LIMITS.largeTransactionCents
  return cents >= min && cents <= max ? cents : null
}

export function LargeChargeField({
  cents,
  save,
}: {
  cents: number
  save: (cents: number) => void
}) {
  const [text, setText] = useState(asTyped(cents))
  function commit() {
    const next = chargeCents(text)
    if (next === null) return setText(asTyped(cents))
    if (next !== cents) save(next)
  }

  return (
    <label className="threshold">
      At least
      <input
        className="input num"
        style={{ width: 112 }}
        inputMode="decimal"
        aria-label="Amount of a large charge"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
      />
    </label>
  )
}
