// Where a goal's progress comes from, in its form: an account's balance it
// follows, or a count kept by hand.

import type { Account } from '../../../api/client'
import { Setting } from '../../../components/ui'
import { AmountNote, type AmountField } from '../../../components/AmountNote'

/** The progress choice for a count kept by hand. */
export const BY_HAND = ''

/** Where a goal's progress comes from: an account's balance, or a count kept by hand. */
export function ProgressFields({
  accounts,
  accountId,
  saved,
  savedField,
  note,
  onAccount,
  onSaved,
}: {
  accounts: Account[]
  accountId: string
  saved: string
  savedField: AmountField
  /** A line under the choice, like the emergency fund losing the account picked. */
  note: string | null
  onAccount: (id: string) => void
  onSaved: (text: string) => void
}) {
  return (
    <>
      <Setting label="Progress" hint="Follow an account's balance, or count it yourself">
        <select
          className="input"
          aria-label="Progress"
          style={{ width: 'auto' }}
          value={accountId}
          onChange={(e) => onAccount(e.target.value)}
        >
          <option value={BY_HAND}>Count it myself</option>
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              Follow {account.name}
            </option>
          ))}
        </select>
      </Setting>
      {note && <p className="small muted">{note}</p>}
      {accountId === BY_HAND && (
        <Setting label="Saved so far">
          <input
            className="input num"
            style={{ width: 130 }}
            inputMode="decimal"
            aria-label="Saved so far"
            placeholder="0"
            {...savedField.inputProps}
            value={saved}
            onChange={(e) => onSaved(e.target.value)}
          />
        </Setting>
      )}
      {accountId === BY_HAND && <AmountNote id={savedField.id} text={savedField.shown} />}
    </>
  )
}
