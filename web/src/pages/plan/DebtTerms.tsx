// A card or loan's interest rate and monthly payment, which banks rarely send
// but a payoff plan needs.

import { useState, type FormEvent } from 'react'
import type { Account } from '../../api/client'
import { useActionMutation } from '../../api/hooks'
import { ErrorNote } from '../../components/ui'
import { AmountNote, useAmountField } from '../../components/AmountNote'
import { parseMoney, parseRate } from '../../lib/format'
import { Money } from '../../components/design/Money'

export function DebtTerms({ account }: { account: Account }) {
  const [rate, setRate] = useState(account.aprPercent === null ? '' : String(account.aprPercent))
  const [minimum, setMinimum] = useState(
    account.minimumPaymentCents === null ? '' : String(account.minimumPaymentCents / 100),
  )
  const save = useActionMutation('update_account')
  const aprPercent = parseRate(rate)
  const minimumPaymentCents = parseMoney(minimum)
  const unchanged =
    aprPercent === account.aprPercent && minimumPaymentCents === account.minimumPaymentCents
  // A blank rate or payment clears it, but one typed that cannot be read
  // ("-5" or "150" for a rate, "6O" or "-5" for a payment) must not.
  const badRate = aprPercent === null && rate.trim() !== ''
  const paymentField = useAmountField(minimum, { min: 0 })
  const badPayment = paymentField.note !== null

  function submit(event: FormEvent) {
    event.preventDefault()
    save.mutate({ id: account.id, aprPercent, minimumPaymentCents })
  }

  return (
    <form className="list-row wrap" onSubmit={submit} aria-label={`${account.name} terms`}>
      <span className="grow stack-sm" style={{ gap: 0, minWidth: 140 }}>
        <span style={{ fontWeight: 500 }}>{account.name}</span>
        <span className="small muted">
          <Money cents={account.balanceCents ?? 0} precision="cents" /> owed
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
        {...paymentField.inputProps}
        value={minimum}
        onChange={(e) => setMinimum(e.target.value)}
      />
      <button
        type="submit"
        className="btn"
        disabled={unchanged || badRate || badPayment || save.isPending}
      >
        Save
      </button>
      {/* One row of a list, so the line takes room only once it has words. */}
      <AmountNote id={paymentField.id} text={paymentField.shown} fit />
      <ErrorNote error={save.error} />
    </form>
  )
}
