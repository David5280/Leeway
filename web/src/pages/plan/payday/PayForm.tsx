// The owner's own pay: one paycheck, how often it lands and the next payday.
// Saved, it stands in for what the paychecks show everywhere pay is used.

import { useState, type FormEvent } from 'react'
import type { PayView } from '../../../api/client'
import { useActionMutation } from '../../../api/hooks'
import { ErrorNote, Setting } from '../../../components/ui'
import { parseMoney } from '../../../lib/format'
import { cadenceLabel, PAY_CADENCE_CHOICES, type PayCadenceChoice } from './payText'

/** What the form opens with: the owner's own pay, else the pay in use, else blank. */
function startingPay(view: PayView): { amount: string; cadence: PayCadenceChoice; next: string } {
  const pay = view.yours ?? view.pay
  const cadence = PAY_CADENCE_CHOICES.find((choice) => choice === pay?.cadence) ?? 'biweek'
  const cents = view.yours?.amountCents ?? view.pay?.paycheckCents
  return {
    amount: cents ? String(cents / 100) : '',
    cadence,
    next: pay?.nextPayday ?? '',
  }
}

export function PayForm({ view, onDone }: { view: PayView; onDone?: () => void }) {
  const start = startingPay(view)
  const [amount, setAmount] = useState(start.amount)
  const [cadence, setCadence] = useState<PayCadenceChoice>(start.cadence)
  const [next, setNext] = useState(start.next)
  const save = useActionMutation('set_pay')
  const amountCents = parseMoney(amount)
  const ready = amountCents !== null && amountCents > 0 && next !== ''

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!ready) return
    save.mutate({ pay: { amountCents, cadence, nextPayday: next } }, { onSuccess: onDone })
  }

  return (
    // Named apart from the card around it, which is "Your pay" or "Your own pay".
    <form className="stack-sm" onSubmit={submit} aria-label="Enter your pay">
      <Setting label="One paycheck" hint="What lands in your account">
        <input
          className="input num"
          inputMode="decimal"
          aria-label="One paycheck"
          placeholder="0.00"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </Setting>
      <Setting label="Paid">
        <select
          className="input"
          aria-label="How often you are paid"
          value={cadence}
          onChange={(e) => setCadence(e.target.value as PayCadenceChoice)}
        >
          {PAY_CADENCE_CHOICES.map((choice) => (
            <option key={choice} value={choice}>
              {cadenceLabel(choice)}
            </option>
          ))}
        </select>
      </Setting>
      <Setting label="Next payday">
        <input
          className="input num"
          type="date"
          aria-label="Next payday"
          value={next}
          onChange={(e) => setNext(e.target.value)}
        />
      </Setting>
      <ErrorNote error={save.error} />
      <div className="row">
        <button type="submit" className="btn primary" disabled={!ready || save.isPending}>
          Save
        </button>
        {onDone && (
          <button type="button" className="btn ghost" onClick={onDone}>
            Cancel
          </button>
        )}
      </div>
    </form>
  )
}
