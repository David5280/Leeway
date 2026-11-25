// The accounts, grouped by kind (checking, credit cards, savings,
// investments, retirement, loans, other), each group under its icon and
// title, with the group's total at the end of its heading. On Home each
// account is one row opening its own page, with what the credit cards cost
// in interest a month under them. On Compare accounts each is a card with its
// facts, and the whole card is a tick box; the totals still count the group.

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
import { useApp } from '../../lib/app'
import { PickCard } from './AccountCard'
import { AccountRow } from './AccountRow'
import { CardsInterestLine } from './CardInterest'

/**
 * Picking accounts to compare: which are ticked, how to tick or untick one,
 * and what the cards' facts are read from.
 */
export interface Picking {
  picked: readonly string[]
  toggle: (id: string) => void
  /** Each account's daily balances for the last 30 days, oldest first. */
  balances: ReadonlyMap<string, readonly number[]>
  goals: readonly Goal[]
}

export function AccountGroups({
  accounts,
  picking,
}: {
  accounts: readonly Account[]
  /** Set while picking accounts to compare; without it each row opens its account. */
  picking?: Picking
}) {
  return (
    <>
      {groupAccounts(accounts).map((group) => (
        <section key={group.kind} className="acct-group" aria-label={group.title}>
          <SectionHead
            icon={group.icon}
            title={group.title}
            // On Home the groups sit inside the Accounts card, under its title.
            level={picking ? 2 : 3}
            aside={<GroupTotalFigure total={groupTotal(group.kind, group.accounts)} />}
          />
          {group.kind === 'credit_card' && !picking && (
            <CardsInterestLine accounts={group.accounts} />
          )}
          {picking ? (
            <PickCards accounts={group.accounts} picking={picking} />
          ) : (
            <div className="acct-rows">
              {group.accounts.map((account) => (
                <AccountRow key={account.id} account={account} />
              ))}
            </div>
          )}
        </section>
      ))}
    </>
  )
}

/** One group's accounts on Compare accounts: each a card with its facts, ticked to pick it. */
function PickCards({ accounts, picking }: { accounts: readonly Account[]; picking: Picking }) {
  const { settings } = useApp()
  return (
    <div className="acct-grid">
      {accounts.map((account) => (
        <PickCard
          key={account.id}
          account={account}
          facts={accountFacts(account, {
            balances: picking.balances.get(account.id),
            goals: goalsOn(account, picking.goals),
            locale: settings.locale,
          })}
          picked={picking.picked.includes(account.id)}
          onToggle={() => picking.toggle(account.id)}
        />
      ))}
    </div>
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
