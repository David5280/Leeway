// The foot of the Inbox: what Leeway watches for, in plain words, with the
// thresholds read from the server's own rules so the words never drift from
// what it checks, and where each account's warning is set.

import { Link } from 'react-router-dom'
import { DEFAULT_LOW_BALANCE_CENTS, FEE_DAYS } from '../../../../server/src/domain/accountAlerts'
import { BILL_CHANGE_THRESHOLD } from '../../../../server/src/domain/billAmountChange'
import { DUPLICATE_DAYS } from '../../../../server/src/domain/leaks/duplicates'
import { PRICE_RISE } from '../../../../server/src/domain/leaks/priceRises'
import { Card } from '../../components/design/Card'
import { Money } from '../../components/design/Money'
import { settingsPath } from '../settings/paths'

export function WhatLeewayWatches() {
  return (
    <Card static="words" label="About alerts" className="stack-sm">
      <h2>What Leeway watches</h2>
      <ul className="summary-points small">
        <li>
          A checking or savings account below zero, by either its current or its available balance.
        </li>
        <li>A credit card past its credit limit.</li>
        <li>
          A bill whose latest charge was at least {BILL_CHANGE_THRESHOLD.share * 100}% and{' '}
          <Money cents={BILL_CHANGE_THRESHOLD.cents} /> off its usual amount. Dismissing it, or the
          same new amount twice in a row, makes that the usual amount.
        </li>
        <li>Overdraft and insufficient funds fees in the last {FEE_DAYS} days.</li>
        <li>
          The same charge at one place more than once within {DUPLICATE_DAYS} days, unless you buy
          it there often or one was refunded.
        </li>
        <li>
          A charge that repeats quarterly or more often, not yet one of your bills, whose price went
          up by at least {PRICE_RISE.share * 100}% and <Money cents={PRICE_RISE.cents} />. A yearly
          charge has too little history to tell.
        </li>
        <li>
          Money available below your warning: <Money cents={DEFAULT_LOW_BALANCE_CENTS} /> for
          checking accounts unless you set another amount, and off for other accounts until you set
          one.
        </li>
      </ul>
      <p className="small muted">
        Balances come from your bank at every sync. Change each account&apos;s warning in{' '}
        <Link to={settingsPath('accounts')}>Settings, then Accounts</Link>.
      </p>
    </Card>
  )
}
