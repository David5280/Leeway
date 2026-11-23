// The amount a single charge must reach to count as large. Typed in whole
// units, saved when the box is left. One that can't be read, or is outside
// the allowed range, stays in the box with a note saying why, never saved;
// a blank box goes back to the saved amount. Its owner keys it by the saved
// amount, so a save made elsewhere shows here too.

import { useState } from 'react'
import { AmountNote, useAmountField } from '../../../components/AmountNote'
import { useApp } from '../../../lib/app'
import { parseMoney } from '../../../lib/format'
import { LIMITS } from '../../../../../server/src/domain/notifications/settings'

/** The amount as typed in the box: whole units, without a currency sign. */
function asTyped(cents: number): string {
  return String(cents / 100)
}

/** The cents to save from what was typed, or null when it can't be saved. */
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
  const { money } = useApp()
  const [text, setText] = useState(asTyped(cents))
  const { min, max } = LIMITS.largeTransactionCents
  const field = useAmountField(text, {
    min,
    max,
    rangeNote: `Use an amount from ${money(min)} to ${money(max)}.`,
  })

  function commit() {
    field.reveal()
    if (text.trim() === '') return setText(asTyped(cents))
    const next = chargeCents(text)
    if (next !== null && next !== cents) save(next)
  }

  return (
    <div className="stack-xs">
      <label className="threshold">
        At least
        <input
          className="input num"
          style={{ width: 112 }}
          inputMode="decimal"
          aria-label="Amount of a large charge"
          {...field.inputProps}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
        />
      </label>
      <AmountNote id={field.id} text={field.shown} />
    </div>
  )
}
