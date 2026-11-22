// What credit card balances cost in interest, in dollars a month (the math is
// the server's own, cardInterest.ts): on a card's page, its interest, or a
// one-field way to add the APR that figure needs; on the Accounts screen, a
// line under the credit cards with the total a month.

import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import type { Account } from '../../api/client'
import { useActionMutation } from '../../api/hooks'
import { Card } from '../../components/design/Card'
import { Money } from '../../components/design/Money'
import { ErrorNote } from '../../components/ui'
import { cardInterestDrill } from '../../lib/drills/cardInterest'
import { parseRate } from '../plan/DebtTerms'
import { cardInterest, cardInterestTotal } from '../../../../server/src/domain/cardInterest'

/** On a card's page: what its balance costs a month, or a way to add its APR. Nothing once paid off. */
export function InterestCard({ account }: { account: Account }) {
  const card = cardInterest(account)
  if (!card) return null
  if (card.aprPercent === null || card.monthlyInterestCents === null) {
    return <AddApr account={account} />
  }
  return (
    <Card
      drill={cardInterestDrill({
        ...card,
        aprPercent: card.aprPercent,
        monthlyInterestCents: card.monthlyInterestCents,
      })}
      label="Interest on this card"
      className="stack-sm"
    >
      <p style={{ fontSize: 17 }}>
        About <Money cents={card.monthlyInterestCents} className="mid-number" /> a month in interest
      </p>
      <span className="small muted">
        On <Money cents={card.balanceCents} /> owed, at {card.aprPercent}% APR.
      </span>
    </Card>
  )
}

/** The gentle prompt where the interest would show, with the one field it needs. */
function AddApr({ account }: { account: Account }) {
  const [rate, setRate] = useState('')
  const save = useActionMutation('update_account')
  const aprPercent = parseRate(rate)

  function submit(event: FormEvent) {
    event.preventDefault()
    if (aprPercent !== null) save.mutate({ id: account.id, aprPercent })
  }

  return (
    <Card static="form" label="Add this card's APR" className="stack-sm">
      <p className="small">Add this card&apos;s APR to see what the balance costs you.</p>
      <form className="row wrap" style={{ gap: 8 }} onSubmit={submit} aria-label="Card APR">
        <label className="small muted row" style={{ gap: 6 }}>
          <input
            className="input num"
            style={{ width: 96 }}
            inputMode="decimal"
            aria-label="APR"
            placeholder="24.99"
            value={rate}
            onChange={(event) => setRate(event.target.value)}
          />
          % APR
        </label>
        <button type="submit" className="btn" disabled={aprPercent === null || save.isPending}>
          Save
        </button>
      </form>
      <span className="small muted">It&apos;s on your statement, often near the end.</span>
      <ErrorNote error={save.error} />
    </Card>
  )
}

/**
 * Under the credit cards on the Accounts screen: the interest they cost a
 * month, leading to Plan, Debts. Cards with no APR are named by count, or,
 * when none has one, the line asks for them. Nothing when no card owes.
 */
export function CardsInterestLine({ accounts }: { accounts: readonly Account[] }) {
  const { cards, monthlyInterestCents, missingApr } = cardInterestTotal(accounts)
  if (cards.length === 0) return null
  const known = cards.length - missingApr
  return (
    <Link to="/plan/debts" className="group-note small muted">
      {/* One run of text, so the link's flex box wraps it as a sentence, not word by word. */}
      <span>
        {known === 0 ? (
          "Add your cards' APRs to see what their balances cost you."
        ) : (
          <>
            About <Money cents={monthlyInterestCents} /> a month in interest
            {missingApr > 0 &&
              `, not counting ${missingApr} ${missingApr === 1 ? 'card' : 'cards'} with no APR yet`}
            .
          </>
        )}
      </span>
    </Link>
  )
}
