// Each cash account's low-balance warning: Leeway warns on the dashboard when
// the money available drops below it. Left empty it follows the default.

import { useState } from 'react'
import type { Account } from '../../api/client'
import { useActionMutation } from '../../api/hooks'
import { ErrorNote } from '../../components/ui'
import { AmountNote, useAmountField } from '../../components/AmountNote'
import { useApp } from '../../lib/app'
import { parseMoney } from '../../lib/format'
import { lowBalanceThreshold } from '../../../../server/src/domain/accountAlerts'

/** The amount as typed in the box: whole units, without a currency sign. */
function asTyped(cents: number | null): string {
  return cents === null ? '' : String(cents / 100)
}

/**
 * What the empty box falls back to, as its placeholder: the default amount for
 * a checking account, or off for the rest.
 */
function defaultWords(account: Account, money: (cents: number) => string): string {
  const fallback = lowBalanceThreshold({ ...account, lowBalanceCents: null })
  return fallback === null ? 'Off' : money(fallback)
}

export function LowBalanceField({ account }: { account: Account }) {
  const { money } = useApp()
  const update = useActionMutation('update_account')
  const [text, setText] = useState(asTyped(account.lowBalanceCents))
  const field = useAmountField(text, { min: 0 })

  function save() {
    field.reveal()
    // One that can't be read, or a negative one, stays in the box with its
    // note, never saved as the default.
    if (field.note !== null) return
    // Empty goes back to the default; 0 turns the warning off.
    const cents = text.trim() === '' ? null : parseMoney(text)
    if (cents === account.lowBalanceCents) return
    update.mutate({ id: account.id, lowBalanceCents: cents })
  }

  return (
    <div className="stack-xs">
      <label className="small muted row" style={{ gap: 8 }}>
        Warn below
        <input
          className="input num"
          style={{ width: 96 }}
          inputMode="decimal"
          aria-label={`Low balance warning for ${account.name}`}
          placeholder={defaultWords(account, money)}
          {...field.inputProps}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={save}
        />
      </label>
      {/* Under the row, not in it, so a narrow row never has to make room for it. */}
      <AmountNote id={field.id} text={field.shown} fit />
      <ErrorNote error={update.error} />
    </div>
  )
}
