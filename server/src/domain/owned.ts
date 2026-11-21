// Everything owned and owed that the bank link does not cover: a home, a car
// or anything else of value, and loans, entered by hand. Each is a manual
// account (accounts.ts), so it counts in net worth, debt plans and anywhere
// else accounts do; this module only reads them as one list and adds and
// changes them in the words a person uses. A home or car can name the loan
// against it, to show what it is worth to the owner after that loan.

import { z } from 'zod'
import type { Db } from '../db/pool.js'
import { AppError, notFound } from '../errors.js'
import { todayIn, type IsoDate } from '../lib/dates.js'
import { isCounted } from './accountSharing.js'
import {
  getAccount,
  insertManualAccount,
  LIABILITY_TYPES,
  listAccounts,
  updateAccount,
  type Account,
  type AccountType,
} from './accounts.js'

/** What a thing entered by hand is, in everyday words. */
export const HAND_ENTERED_KINDS = ['home', 'vehicle', 'other', 'loan'] as const
export type HandEnteredKind = (typeof HAND_ENTERED_KINDS)[number]

/** How each kind is stored as a manual account. */
const STORED_AS: Record<HandEnteredKind, { type: AccountType; subtype: string | null }> = {
  home: { type: 'property', subtype: 'home' },
  vehicle: { type: 'property', subtype: 'vehicle' },
  other: { type: 'property', subtype: 'other' },
  loan: { type: 'loan', subtype: null },
}

const termsFields = {
  /** Yearly interest rate of a loan, such as 6.5. */
  aprPercent: z.number().min(0).max(100).multipleOf(0.01).nullable(),
  /** What a loan takes each month. */
  monthlyPaymentCents: z.number().int().min(0).nullable(),
  /** For a home, car or other thing owned: the loan against it, or null for none. */
  loanId: z.uuid().nullable(),
}

export const handEnteredInputSchema = z.object({
  kind: z.enum(HAND_ENTERED_KINDS),
  name: z.string().trim().min(1).max(80),
  /** What it is worth, or for a loan what is still owed. */
  amountCents: z.number().int().min(0),
  aprPercent: termsFields.aprPercent.default(null),
  monthlyPaymentCents: termsFields.monthlyPaymentCents.default(null),
  loanId: termsFields.loanId.default(null),
})

export const handEnteredPatchSchema = z
  .object({
    name: handEnteredInputSchema.shape.name,
    amountCents: handEnteredInputSchema.shape.amountCents,
    ...termsFields,
  })
  .partial()

export type HandEnteredInput = z.infer<typeof handEnteredInputSchema>
export type HandEnteredPatch = z.infer<typeof handEnteredPatchSchema>

/** One thing entered by hand, as the Net worth screen and an assistant read it. */
export interface HandEnteredItem {
  id: string
  name: string
  /** What it is: home, vehicle, other or loan; also cash, investment or card for older entries. */
  kind: HandEnteredKind | 'cash' | 'investment' | 'card'
  side: 'owned' | 'owed'
  /** What it is worth, or for a loan or card what is owed; null when not known. */
  amountCents: number | null
  aprPercent: number | null
  monthlyPaymentCents: number | null
  /** For something owned: the loan against it, and that loan's name. */
  loanId: string | null
  loanName: string | null
  /** For something owned with a loan: its value less what the loan owes. */
  equityCents: number | null
  /** The day its amount was last entered. */
  updatedOn: IsoDate | null
  /** False when hidden, which leaves it out of net worth. */
  inNetWorth: boolean
  /** Always true: entered by the owner, not read from a bank. */
  enteredByYou: true
}

export interface OwnedAndOwed {
  owned: HandEnteredItem[]
  owed: HandEnteredItem[]
  /** What the owned things counted in net worth are worth together. */
  ownedCents: number
  /** What the counted loans and cards owe together. */
  owedCents: number
}

/** The everyday kind of a manual account. */
function kindOfItem(account: Account): HandEnteredItem['kind'] {
  if (account.type === 'property') {
    return account.subtype === 'home' || account.subtype === 'vehicle' ? account.subtype : 'other'
  }
  const byType: Partial<Record<AccountType, HandEnteredItem['kind']>> = {
    loan: 'loan',
    credit: 'card',
    depository: 'cash',
    investment: 'investment',
  }
  return byType[account.type] ?? 'other'
}

/** The loan each owned thing names, by the thing's id. */
async function loanLinks(db: Db): Promise<Map<string, string>> {
  const { rows } = await db.query<{ id: string; loanId: string }>(
    `SELECT id, loan_account_id AS "loanId" FROM accounts
     WHERE connection_id IS NULL AND loan_account_id IS NOT NULL`,
  )
  return new Map(rows.map((row) => [row.id, row.loanId]))
}

/** The owner's calendar day a balance was entered; pg reads the time as a Date, typed as text. */
function enteredOn(account: Account, timeZone: string): IsoDate | null {
  return account.balanceUpdatedAt === null
    ? null
    : todayIn(timeZone, new Date(account.balanceUpdatedAt))
}

function itemOf(account: Account, loan: Account | undefined, timeZone: string): HandEnteredItem {
  const owed = LIABILITY_TYPES.includes(account.type)
  const loanOwes = loan && isCounted(loan) ? loan.balanceCents : null
  return {
    id: account.id,
    name: account.name,
    kind: kindOfItem(account),
    side: owed ? 'owed' : 'owned',
    amountCents: account.balanceCents,
    aprPercent: account.aprPercent,
    monthlyPaymentCents: account.minimumPaymentCents,
    loanId: loan?.id ?? null,
    loanName: loan?.name ?? null,
    equityCents:
      account.balanceCents === null || loanOwes === null ? null : account.balanceCents - loanOwes,
    updatedOn: enteredOn(account, timeZone),
    inNetWorth: isCounted(account),
    enteredByYou: true,
  }
}

/** The counted items' amounts added up. */
const totalOf = (items: HandEnteredItem[]) =>
  items.reduce((sum, item) => (item.inNetWorth ? sum + (item.amountCents ?? 0) : sum), 0)

/**
 * Every manual account but a pension (which has its own place under
 * Retirement), split into what is owned and what is owed, by name.
 */
export async function listOwnedAndOwed(db: Db, timeZone: string): Promise<OwnedAndOwed> {
  const accounts = await listAccounts(db)
  const links = await loanLinks(db)
  const byId = new Map(accounts.map((account) => [account.id, account]))
  const items = accounts
    .filter((account) => account.manual && account.kind !== 'pension')
    .map((account) => itemOf(account, byId.get(links.get(account.id) ?? ''), timeZone))
    .sort((a, b) => a.name.localeCompare(b.name))
  const owned = items.filter((item) => item.side === 'owned')
  const owed = items.filter((item) => item.side === 'owed')
  return { owned, owed, ownedCents: totalOf(owned), owedCents: totalOf(owed) }
}

/** One item, read back after a change. */
async function itemById(db: Db, id: string, timeZone: string): Promise<HandEnteredItem> {
  const { owned, owed } = await listOwnedAndOwed(db, timeZone)
  return [...owned, ...owed].find((item) => item.id === id)!
}

/** Names the loan against something owned; the loan must be one owed, and not the thing itself. */
async function linkLoan(db: Db, item: Account, loanId: string | null): Promise<void> {
  if (loanId !== null) {
    if (LIABILITY_TYPES.includes(item.type)) {
      throw new AppError('invalid_input', 'Only something you own can have a loan against it')
    }
    const loan = await getAccount(db, loanId)
    if (!LIABILITY_TYPES.includes(loan.type)) {
      throw new AppError(
        'invalid_input',
        `${loan.name} is not a loan, so it cannot be tied to this`,
      )
    }
  }
  await db.query('UPDATE accounts SET loan_account_id = $2 WHERE id = $1', [item.id, loanId])
}

/** Sets a loan's rate and payment, when the change gives them. */
async function setTerms(db: Db, id: string, terms: HandEnteredPatch): Promise<void> {
  if (terms.aprPercent === undefined && terms.monthlyPaymentCents === undefined) return
  await updateAccount(db, id, {
    aprPercent: terms.aprPercent,
    minimumPaymentCents: terms.monthlyPaymentCents,
  })
}

/** Adds a thing owned or a loan by hand. Run it in a transaction, so it lands whole. */
export async function addHandEntered(
  db: Db,
  input: HandEnteredInput,
  { currency, timeZone }: { currency: string; timeZone: string },
): Promise<HandEnteredItem> {
  const account = await insertManualAccount(db, {
    name: input.name,
    ...STORED_AS[input.kind],
    balanceCents: input.amountCents,
    creditLimitCents: null,
    currency,
    kind: null,
  })
  await setTerms(db, account.id, input)
  if (input.loanId !== null) await linkLoan(db, account, input.loanId)
  return itemById(db, account.id, timeZone)
}

/** Changes a thing entered by hand. Run it in a transaction, so a change lands whole. */
export async function updateHandEntered(
  db: Db,
  id: string,
  patch: HandEnteredPatch,
  timeZone: string,
): Promise<HandEnteredItem> {
  const account = await getAccount(db, id)
  if (!account.manual) {
    throw new AppError(
      'invalid_input',
      `${account.name} comes from your bank, so its balance updates on its own`,
    )
  }
  if (account.kind === 'pension') throw notFound('Hand-entered item')
  await updateAccount(db, id, { displayName: patch.name, balanceCents: patch.amountCents })
  await setTerms(db, id, patch)
  if (patch.loanId !== undefined) await linkLoan(db, account, patch.loanId)
  return itemById(db, id, timeZone)
}
