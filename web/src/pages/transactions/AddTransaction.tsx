// The form for adding a transaction by hand.

import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import type { Category } from '../../api/client'
import { useAction, useActionMutation } from '../../api/hooks'
import { CategorySelect } from '../../components/CategorySelect'
import { ErrorNote, Segmented } from '../../components/ui'
import { UnreadableAmount } from '../../components/UnreadableAmount'
import { useApp } from '../../lib/app'
import { isoDaysAgo } from '../../lib/dates'
import { parseMoney } from '../../lib/format'
import { settingsPath } from '../settings/paths'

const DIRECTIONS = [
  { value: 'out', label: 'Spent' },
  { value: 'in', label: 'Received' },
] as const

/** Records cash or anything the bank does not see. */
export function AddTransaction({
  categories,
  onDone,
}: {
  categories: Category[]
  onDone: () => void
}) {
  const { settings } = useApp()
  const accounts = useAction('list_accounts')
  const create = useActionMutation('create_transaction')
  const [accountId, setAccountId] = useState('')
  const [date, setDate] = useState(() => isoDaysAgo(0, settings.timeZone))
  const [name, setName] = useState('')
  const [amount, setAmount] = useState('')
  const [moneyIn, setMoneyIn] = useState(false)
  const [categoryId, setCategoryId] = useState<string | null>(null)
  const cents = parseMoney(amount)
  // Until the owner picks one, the first account is selected.
  const account = accountId || accounts.data?.[0]?.id || ''

  function submit(event: FormEvent) {
    event.preventDefault()
    if (cents === null || !account) return
    create.mutate(
      {
        accountId: account,
        date,
        name,
        // Money in is stored negative, money out positive.
        amountCents: moneyIn ? -Math.abs(cents) : Math.abs(cents),
        categoryId,
      },
      { onSuccess: onDone },
    )
  }

  if (accounts.data?.length === 0) {
    return (
      <p className="notice">
        Add an account first, in <Link to={settingsPath('accounts')}>Settings, then Accounts</Link>,
        then record cash spending here.
      </p>
    )
  }
  return (
    <form className="card stack-sm" onSubmit={submit} aria-label="Add a transaction">
      <div className="row wrap">
        <input
          className="input"
          type="date"
          aria-label="Date"
          required
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
        <input
          className="input grow name-field"
          placeholder="What was it"
          aria-label="Description"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          className="input num"
          style={{ width: 110 }}
          inputMode="decimal"
          placeholder="0.00"
          aria-label="Amount"
          required
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <Segmented
          label="Direction"
          value={moneyIn ? 'in' : 'out'}
          options={DIRECTIONS}
          onChange={(v) => setMoneyIn(v === 'in')}
        />
      </div>
      <div className="row wrap">
        <select
          className="input"
          style={{ width: 'auto' }}
          aria-label="Account"
          value={account}
          onChange={(e) => setAccountId(e.target.value)}
        >
          {accounts.data?.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <div style={{ width: 200 }}>
          <CategorySelect
            categories={categories}
            value={categoryId}
            label="Category"
            emptyLabel="Let rules decide"
            onChange={setCategoryId}
          />
        </div>
        <button type="submit" className="btn primary" disabled={create.isPending || cents === null}>
          Add
        </button>
      </div>
      <UnreadableAmount text={amount} />
      <ErrorNote error={create.error} />
    </form>
  )
}
