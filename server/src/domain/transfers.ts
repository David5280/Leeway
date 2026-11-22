// Telling a transfer (money moving between the owner's own accounts) from
// real spending and income. Pure functions, so the rules read and test alone.
//
// Plaid's codes say what kind of movement a transaction is, but not where the
// money went. A credit card payment, for one, is only a transfer when the card
// is tracked here too: then its purchases are already counted, and counting
// the payment again would count them twice. Paid to a card Leeway cannot see,
// the payment is the only trace of that spending, so it must count.

/** The owner's accounts, as far as deciding transfers needs them. */
export interface OwnAccounts {
  /**
   * The last four digits of each connected credit card that counts toward
   * budgets. A card without digits from the bank is listed as null.
   */
  cardMasks: (string | null)[]
}

/** No accounts tracked: every card payment counts as spending. */
export const NO_ACCOUNTS: OwnAccounts = { cardMasks: [] }

/** Whether two snapshots of the owner's accounts would decide transfers the same way. */
export function sameOwnAccounts(a: OwnAccounts, b: OwnAccounts): boolean {
  const key = (accounts: OwnAccounts) => [...accounts.cardMasks].sort().join(',')
  return a.cardMasks.length === b.cardMasks.length && key(a) === key(b)
}

/** What deciding a transfer reads from a transaction. */
export interface Movement {
  name: string
  merchantName: string | null
  /** Positive is money out, negative is money in. */
  amountCents: number
  providerCategoryPrimary: string | null
  providerCategoryDetailed: string | null
  /** The type of the account the transaction is on, when known. */
  accountType?: string | null
}

export const CARD_PAYMENT_CODE = 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT'
/** Plaid's code for cash taken out at an ATM or a teller. */
export const CASH_WITHDRAWAL_CODE = 'TRANSFER_OUT_WITHDRAWAL'

// Apps people use to pay each other. Matched as whole words, so "paypal" in
// "PAYPAL *ETSY" counts but a merchant that merely contains the letters does not.
const PERSON_TO_PERSON_APPS: { app: string; pattern: RegExp }[] = [
  { app: 'Zelle', pattern: /\bzelle\b/i },
  { app: 'Venmo', pattern: /\bvenmo\b/i },
  { app: 'Cash App', pattern: /\bcash ?app\b/i },
  { app: 'PayPal', pattern: /\bpaypal\b/i },
  { app: 'Apple Cash', pattern: /\bapple cash\b/i },
]

// Plaid's own codes for money sent or received through an app (PFC v2).
const APP_TRANSFER_CODES = new Set([
  'TRANSFER_IN_TRANSFER_IN_FROM_APPS',
  'TRANSFER_OUT_TRANSFER_OUT_FROM_APPS',
])

/** The most specific code the bank gave, or an empty string. */
function codeOf(tx: Movement): string {
  return tx.providerCategoryDetailed ?? tx.providerCategoryPrimary ?? ''
}

/** The payment app a transaction went through, if it looks like one person paying another. */
export function personToPersonApp(tx: Movement): string | null {
  const text = `${tx.name} ${tx.merchantName ?? ''}`
  const found = PERSON_TO_PERSON_APPS.find(({ pattern }) => pattern.test(text))
  if (found) return found.app
  return APP_TRANSFER_CODES.has(codeOf(tx)) ? 'a payment app' : null
}

// "ending in 1234", "x1234", "*1234" and "...1234": how banks write a card's
// last four digits in a payment's description.
const CARD_DIGITS = /(?:ending in\s+|(?<![a-z])x+|\*+|\.{3})(\d{4})\b/i

/**
 * Whether a credit card payment went to a card tracked here. When the
 * description names the card's last four digits, they must match a tracked
 * card (or one whose digits are unknown); otherwise any tracked card will do.
 */
export function paysTrackedCard(tx: Movement, accounts: OwnAccounts): boolean {
  if (accounts.cardMasks.length === 0) return false
  const digits = CARD_DIGITS.exec(tx.name)?.[1]
  if (!digits) return true
  return accounts.cardMasks.some((mask) => mask === null || mask === digits)
}

/**
 * Whether a transaction only moves money between the owner's own accounts (or
 * borrows it), so it is neither spending nor income. Only consulted where a
 * transfer category claims the transaction's bank code.
 *
 * - Loan and card payments are transfers on the card or loan account itself
 *   (the other side is already counted), and a card payment out of checking is
 *   one when it pays a tracked card. Car, mortgage, student, buy now pay later
 *   and other loan payments out of checking are spending.
 * - Bank transfers are transfers unless they went through a payment app to or
 *   from another person, which is real spending or income. Cash taken out at
 *   an ATM leaves the tracked accounts, so it is spending too.
 * - Any other code an owner put in a transfer category (borrowed money, say)
 *   is taken as a transfer.
 */
export function isTransfer(tx: Movement, accounts: OwnAccounts): boolean {
  const code = codeOf(tx)
  if (code.startsWith('LOAN_PAYMENTS')) {
    if (tx.accountType === 'credit' || tx.accountType === 'loan') return true
    return code === CARD_PAYMENT_CODE && paysTrackedCard(tx, accounts)
  }
  if (code === CASH_WITHDRAWAL_CODE) return false
  if (code.startsWith('TRANSFER_')) return personToPersonApp(tx) === null
  return true
}

/** One person paying another, as the app shows it: who, which way, and through what. */
export interface PersonPayment {
  app: string
  /** Read from the amount alone: negative is money received, positive is money sent. */
  direction: 'in' | 'out'
  /** The other person's name, when the description gives it. */
  counterparty: string | null
}

// "Zelle payment to JANE DOE JPM99A1B2C3" or "Zelle Payment From Jane Doe 12345":
// the name sits between "to" or "from" and a trailing confirmation code.
const NAMED_PAYMENT = /\b(?:to|from)\s+(.+)$/i

/** Drops trailing reference codes (any word with a digit in it) from a name. */
function withoutReference(text: string): string {
  const words = text.trim().split(/\s+/)
  while (words.length > 0 && /\d/.test(words.at(-1)!)) words.pop()
  return words.join(' ')
}

/** "JANE DOE" reads as "Jane Doe"; a name already in mixed case is left alone. */
function tidyName(name: string): string {
  if (name !== name.toUpperCase()) return name
  return name.toLowerCase().replace(/\b\p{L}/gu, (letter) => letter.toUpperCase())
}

/**
 * Reads a payment between people. The direction always comes from the amount,
 * never from "to" or "from" in the description, so a bank's wording can never
 * turn money received into money sent.
 */
export function personPayment(tx: Movement): PersonPayment | null {
  const app = personToPersonApp(tx)
  if (!app || tx.amountCents === 0) return null
  const named = NAMED_PAYMENT.exec(tx.name)?.[1]
  const counterparty = named ? withoutReference(named) : ''
  return {
    app,
    direction: tx.amountCents < 0 ? 'in' : 'out',
    counterparty: counterparty ? tidyName(counterparty) : null,
  }
}
