// The Accounts screen's cards, grouped by kind (checking, credit cards,
// savings, investments, retirement, loans, other), each group under its
// icon and title. In Select mode every card is a tick box.

import type { Account, Goal } from '../../api/client'
import { SectionHead } from '../../components/design/SectionHead'
import { accountFacts, goalsOn, groupAccounts } from '../../lib/accountCards'
import { AccountCard, PickCard } from './AccountCard'

/** Select mode: which accounts are ticked, and how to tick or untick one. */
export interface Picking {
  picked: readonly string[]
  toggle: (id: string) => void
}

export function AccountGroups({
  accounts,
  balances,
  goals,
  picking,
}: {
  accounts: readonly Account[]
  /** Each account's daily balances for the last 30 days, oldest first. */
  balances: ReadonlyMap<string, readonly number[]>
  goals: readonly Goal[]
  /** Set in Select mode; null when each card opens its account. */
  picking: Picking | null
}) {
  return (
    <>
      {groupAccounts(accounts).map((group) => (
        <section key={group.kind} className="acct-group" aria-label={group.title}>
          <SectionHead icon={group.icon} title={group.title} />
          <div className="acct-grid">
            {group.accounts.map((account) => {
              const facts = accountFacts(account, {
                balances: balances.get(account.id),
                goals: goalsOn(account, goals),
              })
              return picking ? (
                <PickCard
                  key={account.id}
                  account={account}
                  facts={facts}
                  picked={picking.picked.includes(account.id)}
                  onToggle={() => picking.toggle(account.id)}
                />
              ) : (
                <AccountCard key={account.id} account={account} facts={facts} />
              )
            })}
          </div>
        </section>
      ))}
    </>
  )
}
