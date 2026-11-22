// Reading the form for something owned or owed back into what to save, and
// the loans a home or car can be tied to. Pure, so every rule is tested
// alone. The rules themselves are the server's (domain/ownedRules.ts), so the
// form refuses only what the server would.

import {
  amountProblem,
  carriesLoan,
  isLoan,
  MAX_AMOUNT_CENTS,
} from '../../../../../server/src/domain/ownedRules'
import type { Account } from '../../../api/client'
import { parseMoney } from '../../../lib/format'
import { isUnreadableRate, parseRate } from '../DebtTerms'
import { isOwedKind, type OwnedItem, type OwnedText } from './ownedText'

/** What the form holds, read: a loan's terms, or a home or car's loan, only where they apply. */
export interface OwnedFields {
  name: string
  amountCents: number
  aprPercent?: number | null
  monthlyPaymentCents?: number | null
  loanId?: string | null
}

/** What an edit sends: the same, but the amount only when it changed. */
export type OwnedEdit = Omit<OwnedFields, 'amountCents'> & { amountCents?: number }

/** A value read from the form, or the sentence that says what to fix. */
type Read<T> = { ok: true; value: T } | { ok: false; error: string }

export type OwnedRead = Read<OwnedFields>

type Terms = Pick<OwnedFields, 'aprPercent' | 'monthlyPaymentCents'>

const TOO_MUCH = 'Use $1,000,000,000 or less.'

const refuse = (error: string): { ok: false; error: string } => ({ ok: false, error })

/** A loan or card's rate and payment, or why they can't be read. */
function readTerms(text: OwnedText): Read<Terms> {
  // A blank field clears its term; one typed that can't be read must not.
  if (isUnreadableRate(text.rate)) return refuse('Enter the rate as a number, like 6.5.')
  const aprPercent = parseRate(text.rate)
  if (aprPercent !== null && aprPercent > 100) return refuse('Use a rate of 100% or less.')
  const monthlyPaymentCents = parseMoney(text.payment)
  if (monthlyPaymentCents === null && text.payment.trim() !== '') {
    return refuse('Enter the monthly payment as an amount, like 350.')
  }
  if (monthlyPaymentCents !== null && monthlyPaymentCents < 0) {
    return refuse("A monthly payment can't be below zero.")
  }
  if (monthlyPaymentCents !== null && monthlyPaymentCents > MAX_AMOUNT_CENTS) {
    return refuse(TOO_MUCH)
  }
  return { ok: true, value: { aprPercent, monthlyPaymentCents } }
}

/**
 * The form's text as what to save for a thing of `kind`, or the first thing
 * to fix. Nothing is ever changed quietly: an amount below zero that the kind
 * can't hold, or a rate or payment that can't be read, is refused with a
 * sentence rather than saved as something else.
 */
export function readOwned(text: OwnedText, kind: OwnedItem['kind']): OwnedRead {
  const amountCents = parseMoney(text.amount)
  if (amountCents === null) return refuse('Enter an amount, like 450,000.')
  if (Math.abs(amountCents) > MAX_AMOUNT_CENTS) return refuse(TOO_MUCH)
  const problem = amountProblem(kind, amountCents)
  if (problem) return refuse(problem)
  const fields = { name: text.name, amountCents }
  if (isOwedKind(kind)) {
    const terms = readTerms(text)
    return terms.ok ? { ok: true, value: { ...fields, ...terms.value } } : terms
  }
  if (!carriesLoan(kind)) return { ok: true, value: fields }
  return { ok: true, value: { ...fields, loanId: text.loanId || null } }
}

/**
 * What saving an edit sends: the amount only when it changed, so a new name
 * alone leaves the day the amount was entered as it was.
 */
export function editOf(fields: OwnedFields, item: OwnedItem): OwnedEdit {
  if (fields.amountCents !== item.amountCents) return fields
  const { amountCents: _unchanged, ...rest } = fields
  return rest
}

/** A loan the form offers, by id, with the words its option shows. */
export interface LoanChoice {
  id: string
  label: string
}

/**
 * The loans a home or car can be tied to: every counted loan (never a card),
 * and always the one it is tied to now, even when hidden, so the form shows
 * the truth and None really unties it.
 */
export function loanChoices(accounts: Account[], item?: OwnedItem): LoanChoice[] {
  const open = accounts
    .filter((account) => isLoan(account) && !account.hidden && account.id !== item?.id)
    .map((account) => ({ id: account.id, label: account.name }))
  const tiedId = item?.loanId ?? null
  if (tiedId === null || open.some((choice) => choice.id === tiedId)) return open
  // Left out above, so hidden, or not in the accounts loaded yet: named from the item then.
  const tied = accounts.find((account) => account.id === tiedId)
  const name = tied?.name ?? item?.loanName ?? 'The loan tied to it'
  return [{ id: tiedId, label: tied?.hidden ? `${name} (hidden)` : name }, ...open]
}
