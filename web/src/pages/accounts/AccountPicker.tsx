// Which accounts the Accounts dashboard shows: every one, or any few.

import type { Account } from '../../api/client'
import { accountName, toggleAccount } from '../../lib/accounts'

export function AccountPicker({
  accounts,
  picked,
  onChange,
}: {
  accounts: Account[]
  /** The ids picked; empty means every account. */
  picked: string[]
  onChange: (next: string[]) => void
}) {
  const all = picked.length === 0
  const allIds = accounts.map((account) => account.id)
  return (
    <div role="group" aria-label="Accounts to show" className="row wrap" style={{ gap: 8 }}>
      <button
        type="button"
        className={all ? 'chip on' : 'chip'}
        aria-pressed={all}
        onClick={() => onChange([])}
      >
        All accounts
      </button>
      {accounts.map((account) => {
        const on = !all && picked.includes(account.id)
        return (
          <button
            key={account.id}
            type="button"
            className={on ? 'chip on' : 'chip'}
            aria-pressed={on}
            onClick={() => onChange(toggleAccount(picked, account.id, allIds))}
          >
            {accountName(account)}
            {account.mask && <span className="num chip-mask"> ··{account.mask}</span>}
          </button>
        )
      })}
    </div>
  )
}
