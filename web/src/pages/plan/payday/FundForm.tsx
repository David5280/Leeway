// Adding a yearly or quarterly cost by hand: its name, what it costs, how
// often and when it is next due.

import { useState, type FormEvent } from 'react'
import { useActionMutation } from '../../../api/hooks'
import { ErrorNote, Segmented, Setting } from '../../../components/ui'
import { parseMoney } from '../../../lib/format'
import { FUND_CADENCE_CHOICES } from './fundText'

type Cadence = (typeof FUND_CADENCE_CHOICES)[number]['value']

export function FundForm({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState('')
  const [amount, setAmount] = useState('')
  const [cadence, setCadence] = useState<Cadence>('year')
  const [dueDate, setDueDate] = useState('')
  const add = useActionMutation('add_sinking_fund')
  const amountCents = parseMoney(amount)
  const ready = name.trim() !== '' && amountCents !== null && amountCents > 0 && dueDate !== ''

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!ready) return
    add.mutate({ name, amountCents, cadence, dueDate }, { onSuccess: onDone })
  }

  return (
    <form className="stack-sm" onSubmit={submit} aria-label="New yearly cost">
      <Setting label="Name">
        <input
          className="input"
          aria-label="Name"
          placeholder="Car insurance"
          maxLength={80}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </Setting>
      <Setting label="Costs">
        <input
          className="input num"
          inputMode="decimal"
          aria-label="Costs"
          placeholder="0.00"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </Setting>
      <Segmented
        label="How often"
        value={cadence}
        options={FUND_CADENCE_CHOICES}
        onChange={setCadence}
      />
      <Setting label="Next due">
        <input
          className="input num"
          type="date"
          aria-label="Next due"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
        />
      </Setting>
      <ErrorNote error={add.error} />
      <div className="row">
        <button type="submit" className="btn primary" disabled={!ready || add.isPending}>
          Add
        </button>
        <button type="button" className="btn ghost" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  )
}
