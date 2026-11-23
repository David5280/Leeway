// The owner's own pay: one paycheck, how often it lands and the next payday.
// Saved, it stands in for what the paychecks show everywhere pay is used:
// for the main job, when two are found.

import { useState, type FormEvent } from 'react'
import { PAYDAY_RANGE_DAYS } from '../../../../../server/src/domain/pay/ownSchedule'
import type { PayView } from '../../../api/client'
import { useActionMutation } from '../../../api/hooks'
import { ErrorNote, Setting } from '../../../components/ui'
import { useApp } from '../../../lib/app'
import { isoDaysAgo } from '../../../lib/dates'
import { parseMoney } from '../../../lib/format'
import { typedAmount } from '../../../lib/money'
import { cadenceLabel, PAY_CADENCE_CHOICES, type PayCadenceChoice } from './payText'

/** What the form opens with: the owner's own pay, else the pay in use, else blank. */
function startingPay(view: PayView): { amount: string; cadence: PayCadenceChoice; next: string } {
  const pay = view.yours ?? view.pay
  const cadence = PAY_CADENCE_CHOICES.find((choice) => choice === pay?.cadence) ?? 'biweek'
  const cents = view.yours?.amountCents ?? view.pay?.paycheckCents
  return {
    // As typed, to the cent: 2100.50, never 2100.5.
    amount: cents ? typedAmount(cents) : '',
    cadence,
    next: pay?.nextPayday ?? '',
  }
}

export function PayForm({ view, onDone }: { view: PayView; onDone?: () => void }) {
  const { settings } = useApp()
  const start = startingPay(view)
  // With two jobs found, the pay entered is the main one's; the other still counts.
  const twoJobs = (view.found?.employers.length ?? 0) > 1
  // The server takes a payday within a year of today either way.
  const earliest = isoDaysAgo(PAYDAY_RANGE_DAYS, settings.timeZone)
  const latest = isoDaysAgo(-PAYDAY_RANGE_DAYS, settings.timeZone)
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
      <Setting
        label="One paycheck"
        hint={
          twoJobs
            ? 'From your main job. Your other job still counts.'
            : 'What lands in your account'
        }
      >
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
          min={earliest}
          max={latest}
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
