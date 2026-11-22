// Each cash account's low-balance warning: Leeway warns on the dashboard when
// the money available drops below it. Left empty it follows the default.

import { useState } from 'react'
import type { Account } from '../../api/client'
import { useActionMutation } from '../../api/hooks'
import { ErrorNote } from '../../components/ui'
import { UnreadableAmount } from '../../components/UnreadableAmount'
import { useApp } from '../../lib/app'
import { isUnreadableMoney, parseMoney } from '../../lib/format'
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

  function save() {
    // One typed that can't be read stays in the box with its note, never saved as the default.
    if (isUnreadableMoney(text)) return
    // Empty goes back to the default; 0 turns the warning off.
    const cents = text.trim() === '' ? null : parseMoney(text)
    if (cents !== null && cents < 0) return setText(asTyped(account.lowBalanceCents))
    if (cents === account.lowBalanceCents) return
    update.mutate({ id: account.id, lowBalanceCents: cents })
  }

  return (
    <label className="small muted row" style={{ gap: 8 }}>
      Warn below
      <input
        className="input num"
        style={{ width: 96 }}
        inputMode="decimal"
        aria-label={`Low balance warning for ${account.name}`}
        placeholder={defaultWords(account, money)}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={save}
      />
      <UnreadableAmount text={text} />
      <ErrorNote error={update.error} />
    </label>
  )
}
