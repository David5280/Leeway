// One account as a card on Compare accounts: its kind's icon, its name as
// the owner typed it, its balance as the hero figure, and the one or two
// facts that matter for its kind (lib/accountCards.ts). The whole card is a
// tick box. Home lists each account as a row instead (AccountRow.tsx).

import type { Account } from '../../api/client'
import { Card } from '../../components/design/Card'
import { Money } from '../../components/design/Money'
import { ProgressRing } from '../../components/design/ProgressRing'
import { Sparkline } from '../../components/design/Sparkline'
import { Icon } from '../../components/ui'
import { kindIcon, type AccountFact } from '../../lib/accountCards'
import { accountDetail, isOwed, overdrawn } from '../../lib/accounts'

/** One fact under the balance, always in words as well as any colour or shape. */
function Fact({ fact }: { fact: AccountFact }) {
  switch (fact.kind) {
    case 'ring':
      return (
        <span className="acct-fact">
          <ProgressRing percent={fact.percent} label={fact.label} status={fact.status} size={36} />
          <span className="acct-fact-label">{fact.label}</span>
        </span>
      )
    case 'money':
      return (
        <span className="acct-fact">
          <Money cents={fact.cents} sign={fact.sign} tone={fact.tone} className="strong" />
          <span className="acct-fact-label">{fact.label}</span>
        </span>
      )
    case 'text':
      return (
        <span className="acct-fact">
          <span className={`strong ${fact.tone ? `word-${fact.tone}` : ''}`}>{fact.text}</span>
          {fact.label !== 'Status' && <span className="acct-fact-label">{fact.label}</span>}
        </span>
      )
    case 'spark':
      return (
        <span className="acct-fact acct-fact-spark">
          <Sparkline values={fact.values} label={fact.label} area />
        </span>
      )
  }
}

/** What a card shows: the account, its balance and its facts. */
function AccountFace({ account, facts }: { account: Account; facts: AccountFact[] }) {
  const owed = isOwed(account)
  return (
    <>
      <span className="acct-head">
        <span className="kind-chip" aria-hidden="true">
          <Icon name={kindIcon(account.kind)} size={18} />
        </span>
        <span className="acct-names">
          <span className="acct-name">{account.name}</span>
          <span className="acct-detail">
            {accountDetail(account)}
            {account.hidden && ' · ignored for budgets'}
          </span>
        </span>
      </span>
      <span className="acct-balance">
        {account.balanceCents === null ? (
          <span className="muted">No balance yet</span>
        ) : (
          <Money
            cents={account.balanceCents}
            precision="cents"
            tone={overdrawn(account) ? 'problem' : undefined}
            className="acct-figure"
          />
        )}
        {owed && account.balanceCents !== null && <span className="acct-owed">owed</span>}
      </span>
      {facts.length > 0 && (
        <span className="acct-facts">
          {facts.map((fact) => (
            <Fact key={`${fact.kind}-${fact.label}`} fact={fact} />
          ))}
        </span>
      )}
    </>
  )
}

/** An account's card on Compare accounts: the whole card is the tick box. */
export function PickCard({
  account,
  facts,
  picked,
  onToggle,
}: {
  account: Account
  facts: AccountFact[]
  picked: boolean
  onToggle: () => void
}) {
  return (
    <Card
      static="form"
      label={account.name}
      className={`acct-card card-tap ${picked ? 'acct-picked' : ''}`}
    >
      <label className="card-press">
        <span className="acct-tick">
          <input
            type="checkbox"
            checked={picked}
            onChange={onToggle}
            aria-label={`Pick ${account.name}`}
          />
        </span>
        <AccountFace account={account} facts={facts} />
      </label>
    </Card>
  )
}
