// Words for what the owner entered by hand: what each thing is, and the form's
// starting text. Pure, so each wording is tested alone.

import type { Output } from '../../../api/client'
import { relativeDay } from '../../../lib/format'
import { percentText } from '../../../lib/money'

export type OwnedAndOwed = Output<'list_owned_and_owed'>
export type OwnedItem = OwnedAndOwed['owned'][number]

/** The kinds a new thing can be, as the form offers them. */
export const NEW_KINDS = [
  { value: 'home', label: 'Home' },
  { value: 'vehicle', label: 'Car' },
  { value: 'other', label: 'Other' },
  { value: 'loan', label: 'Loan' },
] as const

export type NewKind = (typeof NEW_KINDS)[number]['value']

/** Each kind in a word or two, for a row's detail line. */
const KIND_WORDS: Record<OwnedItem['kind'], string> = {
  home: 'Home',
  vehicle: 'Car',
  other: 'Something you own',
  loan: 'Loan',
  cash: 'Cash',
  investment: 'Investments',
  card: 'Card',
}

/**
 * The kind, with the loan against it or its rate as `locale` writes it:
 * "Home, with Mortgage", "Loan at 6.5%".
 */
function termsOf(item: OwnedItem, locale: string): string {
  const kind = KIND_WORDS[item.kind]
  if (item.loanName) return `${kind}, with ${item.loanName}`
  if (item.aprPercent !== null) return `${kind} at ${percentText(item.aprPercent, locale)}`
  return kind
}

/** What a row says under the name, and when it is left out of net worth. */
export function itemDetail(item: OwnedItem, locale: string): string {
  const terms = termsOf(item, locale)
  return item.inNetWorth ? terms : `${terms}, hidden from net worth`
}

/**
 * When its amount was last entered: "Updated today", "Updated Tue, Nov 17".
 * Nothing keeps these current but the owner, so each row says how old it is.
 */
export function updatedWords(
  updatedOn: string | null,
  today: string,
  locale?: string,
): string | null {
  if (updatedOn === null) return null
  const day = relativeDay(updatedOn, today, locale)
  // "Today" and "Yesterday" read mid-sentence in lower case; a date keeps its capitals.
  const said = day === 'Today' || day === 'Yesterday' ? day.toLowerCase() : day
  return `Updated ${said}`
}

/** The form's text fields for an item, or blank for a new one. */
export interface OwnedText {
  name: string
  amount: string
  rate: string
  payment: string
  loanId: string
}

const centsText = (cents: number | null) => (cents === null ? '' : String(cents / 100))

export function ownedText(item?: OwnedItem): OwnedText {
  return {
    name: item?.name ?? '',
    amount: centsText(item?.amountCents ?? null),
    rate:
      item?.aprPercent === null || item?.aprPercent === undefined ? '' : String(item.aprPercent),
    payment: centsText(item?.monthlyPaymentCents ?? null),
    loanId: item?.loanId ?? '',
  }
}

/** Whether a kind is owed, so the form asks for its rate and payment rather than a loan against it. */
export const isOwedKind = (kind: OwnedItem['kind']) => kind === 'loan' || kind === 'card'
