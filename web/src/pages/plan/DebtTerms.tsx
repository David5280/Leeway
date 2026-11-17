// A card or loan's interest rate and monthly payment, which banks rarely send
// but a payoff plan needs.

import { useState, type FormEvent } from 'react'
import type { Account } from '../../api/client'
import { useActionMutation } from '../../api/hooks'
import { ErrorNote } from '../../components/ui'
import { useApp } from '../../lib/app'
import { parseMoney } from '../../lib/format'

/** "24.99" into 24.99, rounded to the hundredth; null when blank or not a number. */
export function parseRate(text: string): number | null {
  const value = Number.parseFloat(text.replace(/[^0-9.]/g, ''))
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : null
}

export function DebtTerms({ account }: { account: Account }) {
  const { exact } = useApp()
  const [rate, setRate] = useState(account.aprPercent === null ? '' : String(account.aprPercent))
  const [minimum, setMinimum] = useState(
    account.minimumPaymentCents === null ? '' : String(account.minimumPaymentCents / 100),
  )
  const save = useActionMutation('update_account')
  const aprPercent = parseRate(rate)
  const minimumPaymentCents = parseMoney(minimum)
  const unchanged =
    aprPercent === account.aprPercent && minimumPaymentCents === account.minimumPaymentCents

  function submit(event: FormEvent) {
    event.preventDefault()
    save.mutate({ id: account.id, aprPercent, minimumPaymentCents })
  }

  return (
    <form className="list-row wrap" onSubmit={submit} aria-label={`${account.name} terms`}>
      <span className="grow stack-sm" style={{ gap: 0, minWidth: 140 }}>
        <span style={{ fontWeight: 500 }}>{account.name}</span>
        <span className="small muted">
          <span className="num">{exact(account.balanceCents ?? 0)}</span> owed
        </span>
      </span>
      <label className="small muted row" style={{ gap: 6 }}>
        <input
          className="input num"
          style={{ width: 80 }}
          inputMode="decimal"
          aria-label={`${account.name} interest rate`}
          placeholder="APR"
          value={rate}
          onChange={(e) => setRate(e.target.value)}
        />
        %
      </label>
      <input
        className="input num"
        style={{ width: 110 }}
        inputMode="decimal"
        aria-label={`${account.name} monthly payment`}
        // A card's minimum can be estimated from its balance; a loan's cannot.
        placeholder={account.type === 'credit' ? 'Minimum, est.' : 'Payment'}
        value={minimum}
        onChange={(e) => setMinimum(e.target.value)}
      />
      <button type="submit" className="btn" disabled={unchanged || save.isPending}>
        Save
      </button>
      <ErrorNote error={save.error} />
    </form>
  )
}
