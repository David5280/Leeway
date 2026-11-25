// One account as a single row on Home: its kind's icon, its name with its
// bank under it, and its balance at the end, bold. The whole row opens the
// account's own page, where the facts a card shows (what is available, the
// limit used, what is due) are explained. A row stays one line of figures so
// a long list of accounts still reads at a glance.

import { Link } from 'react-router-dom'
import type { Account } from '../../api/client'
import { Money } from '../../components/design/Money'
import { Icon } from '../../components/ui'
import { kindIcon } from '../../lib/accountCards'
import { accountDetailPath, isOwed, nameUnderBank, overdrawn } from '../../lib/accounts'

/** Where the account sits, without its number: the bank, or that it was added by hand. */
function whereHeld(account: Account): string | null {
  if (account.manual) return 'Added by hand'
  return account.institutionName
}

export function AccountRow({ account }: { account: Account }) {
  const where = whereHeld(account)
  return (
    <Link to={accountDetailPath(account.id)} className="list-row clickrow account-row">
      <span className="kind-chip" aria-hidden="true">
        <Icon name={kindIcon(account.kind)} size={18} />
      </span>
      <span className="grow account-row-names">
        <span className="account-name">{nameUnderBank(account)}</span>
        {(where || account.hidden) && (
          <span className="small muted ellipsis">
            {where}
            {where && account.hidden && ' · '}
            {account.hidden && 'ignored for budgets'}
          </span>
        )}
      </span>
      <RowBalance account={account} />
    </Link>
  )
}

/** The balance, red only for an overdraft, with "owed" after a card's or a loan's. */
function RowBalance({ account }: { account: Account }) {
  if (account.balanceCents === null) {
    return <span className="account-row-balance small muted">No balance yet</span>
  }
  return (
    <span className="account-row-balance">
      <Money
        cents={account.balanceCents}
        precision="cents"
        tone={overdrawn(account) ? 'problem' : undefined}
        className="strong"
      />
      {isOwed(account) && <span className="acct-owed">owed</span>}
    </span>
  )
}
