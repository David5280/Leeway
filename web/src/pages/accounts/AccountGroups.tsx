// The Accounts screen's cards, grouped by kind (checking, credit cards,
// savings, investments, retirement, loans, other), each group under its
// icon and title, with the group's total at the end of its heading, and
// under the credit cards what they cost in interest a month. In Select mode
// every card is a tick box, and the totals still count the group.

import type { Account, Goal } from '../../api/client'
import { SectionHead } from '../../components/design/SectionHead'
import { Money } from '../../components/design/Money'
import {
  accountFacts,
  goalsOn,
  groupAccounts,
  groupTotal,
  type GroupTotal,
} from '../../lib/accountCards'
import { AccountCard, PickCard } from './AccountCard'
import { CardsInterestLine } from './CardInterest'

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
          <SectionHead
            icon={group.icon}
            title={group.title}
            aside={<GroupTotalFigure total={groupTotal(group.kind, group.accounts)} />}
          />
          {group.kind === 'credit_card' && !picking && (
            <CardsInterestLine accounts={group.accounts} />
          )}
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

/** A group's total, bold, with "owed" after a card or loan group's; red only for an overdraft. */
function GroupTotalFigure({ total }: { total: GroupTotal | null }) {
  if (!total) return null
  return (
    <span className="group-total">
      <Money
        cents={total.cents}
        precision="cents"
        tone={total.problem ? 'problem' : undefined}
        className="group-total-figure"
      />
      {total.owed && <span className="acct-owed">owed</span>}
    </span>
  )
}
