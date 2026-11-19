// What kind of account each one is: checking, savings, retirement, pension,
// investing, credit card, loan or other. Worked out from the bank's account type and
// subtype (Plaid's names), unless the owner picked a kind. Every part of
// Leeway that treats accounts differently by kind asks this module. Pure, so
// the web app uses the very same rules.

/** Every kind, in the order accounts are listed. */
export const ACCOUNT_KINDS = [
  'checking',
  'savings',
  'retirement',
  'pension',
  'investment',
  'credit_card',
  'loan',
  'other',
] as const
export type AccountKind = (typeof ACCOUNT_KINDS)[number]

/** Money owed rather than owned. */
export type AccountSide = 'asset' | 'liability'

export interface KindInfo {
  /** A heading for accounts of this kind, like "Retirement". */
  label: string
  /** One account of this kind in words, like "retirement account". */
  noun: string
  /** Which side of net worth the kind sits on; 'other' fits either. */
  side: AccountSide | 'either'
}

export const KIND_INFO: Record<AccountKind, KindInfo> = {
  checking: { label: 'Checking', noun: 'checking account', side: 'asset' },
  savings: { label: 'Savings', noun: 'savings account', side: 'asset' },
  retirement: { label: 'Retirement', noun: 'retirement account', side: 'asset' },
  pension: { label: 'Pensions', noun: 'pension', side: 'asset' },
  investment: { label: 'Investing', noun: 'investment account', side: 'asset' },
  credit_card: { label: 'Credit cards', noun: 'credit card', side: 'liability' },
  loan: { label: 'Loans', noun: 'loan', side: 'liability' },
  other: { label: 'Other', noun: 'account', side: 'either' },
}

/**
 * The kinds that hold money put away for later, in the order they are listed.
 * A pension is not one: it pays a benefit rather than holding a balance to
 * draw on, so retirement projections count it on its own (retirement/).
 */
export const SAVINGS_KINDS = ['savings', 'retirement', 'investment'] as const
export type SavingsKind = (typeof SAVINGS_KINDS)[number]

export function isSavingsKind(kind: AccountKind): kind is SavingsKind {
  return (SAVINGS_KINDS as readonly string[]).includes(kind)
}

// Tax-advantaged retirement plans, by Plaid's investment subtypes (US, Canada
// and UK). Annuities are bought for retirement income, so they count here too.
const RETIREMENT_SUBTYPES = new Set([
  '401a',
  '401k',
  '403b',
  '457b',
  'fixed annuity',
  'ira',
  'keogh',
  'lif',
  'lira',
  'lrif',
  'lrsp',
  'other annuity',
  'prif',
  'profit sharing plan',
  'retirement',
  'rlif',
  'roth',
  'roth 401k',
  'rrif',
  'rrsp',
  'sarsep',
  'sep ira',
  'simple ira',
  'sipp',
  'thrift savings plan',
  'variable annuity',
])

// A defined-benefit pension, as Plaid calls one. It pays a benefit rather than
// holding a balance to draw on, so it is a pension, never retirement savings
// (retirement/pensions.ts), and the owner can enter its plan there.
const PENSION_SUBTYPE = 'pension'

// Investment-type subtypes that hold nothing to invest or withdraw:
// insurance policies and reimbursement plans.
const NOT_INVESTED_SUBTYPES = new Set([
  'health reimbursement arrangement',
  'life insurance',
  'other insurance',
])

// Bank (depository) subtypes that hold savings rather than spending money.
// Anything else at a bank, including no subtype at all, reads as checking.
const SAVINGS_SUBTYPES = new Set(['cd', 'cash isa', 'money market', 'savings'])

// A health savings account is kept for medical costs, with a tax penalty on
// anything else, so it is no emergency fund even when it sits at a bank as
// cash. It counts with investing, where an HSA at a broker already lands.
const HEALTH_SAVINGS_SUBTYPE = 'hsa'

// Account names that say "retirement" when the bank's subtype does not, such
// as a Rollover IRA reported with subtype "other". Matched as whole words.
const RETIREMENT_NAME = /\b(401\s?\(?k\)?|403\s?\(?b\)?|457\s?\(?b\)?|ira|roth|rollover)\b/i

// The same for a pension, such as "PERA Defined Benefit Pension".
const PENSION_NAME = /\bpension\b/i

// The same for a bank account, read more strictly, since a bank account named
// for retirement is rare and an ordinary one named after a person is not:
// "IRA" only in capitals, so "Ira's Savings" stays savings, and no bare
// "rollover", which a bank may call a savings account that rolls over.
const BANK_IRA_NAME = /\bIRA\b/
const BANK_RETIREMENT_NAME = /\b(401\s?\(?k\)?|403\s?\(?b\)?|457\s?\(?b\)?|roth|pension)\b/i

/** Whether a bank account's name says it is held for retirement, like "IRA CD" or "Roth IRA Savings". */
function bankNameSaysRetirement(bankName: string): boolean {
  return BANK_IRA_NAME.test(bankName) || BANK_RETIREMENT_NAME.test(bankName)
}

/** What classifying reads from an account. */
export interface ClassifiableAccount {
  type: string
  subtype: string | null
  /**
   * The bank's name for the account (or the name typed for one added by hand),
   * read for retirement when the subtype does not settle the kind.
   */
  bankName: string
}

/**
 * An investment account whose subtype Leeway does not know, or that has none:
 * a pension or retirement account when its name says so, otherwise investing.
 */
function investmentKindByName(bankName: string): AccountKind {
  if (PENSION_NAME.test(bankName)) return 'pension'
  return RETIREMENT_NAME.test(bankName) ? 'retirement' : 'investment'
}

/** The kind an account is by its type, subtype and name alone. */
export function automaticKind({ type, subtype, bankName }: ClassifiableAccount): AccountKind {
  const sub = subtype?.trim().toLowerCase() ?? ''
  switch (type) {
    case 'credit':
      return 'credit_card'
    case 'loan':
      return 'loan'
    case 'depository':
      if (sub === HEALTH_SAVINGS_SUBTYPE) return 'investment'
      // A CD, savings or cash account held as an IRA is retirement money, not an
      // emergency fund. Only an account the bank calls checking is never read so.
      if (sub !== 'checking' && bankNameSaysRetirement(bankName)) return 'retirement'
      return SAVINGS_SUBTYPES.has(sub) ? 'savings' : 'checking'
    case 'investment':
      if (sub === PENSION_SUBTYPE) return 'pension'
      if (RETIREMENT_SUBTYPES.has(sub)) return 'retirement'
      if (NOT_INVESTED_SUBTYPES.has(sub)) return 'other'
      return investmentKindByName(bankName)
    default:
      return 'other'
  }
}

// Savings subtypes whose money is locked up until a date, so it is no cash to spend.
const LOCKED_SUBTYPES = new Set(['cd'])

/**
 * Whether an account's money is cash the owner can spend before payday: a
 * checking or savings account, by its kind, that is not locked up like a CD.
 * A bank HSA, IRA or anything else the owner calls retirement or investing
 * is not.
 */
export function isSpendableCash(
  account: ClassifiableAccount & { kindChoice: AccountKind | null },
): boolean {
  const kind = kindOf(account)
  if (kind === 'checking') return true
  return kind === 'savings' && !LOCKED_SUBTYPES.has(account.subtype?.trim().toLowerCase() ?? '')
}

/** Card and loan accounts are owed; their balance counts against net worth. */
export function sideOfType(type: string): AccountSide {
  return type === 'credit' || type === 'loan' ? 'liability' : 'asset'
}

/**
 * Whether the owner may call an account of this type this kind. A kind must
 * sit on the same side as the account, so a loan can never be "savings" and
 * a brokerage account never a "credit card".
 */
export function kindFitsType(kind: AccountKind, type: string): boolean {
  const { side } = KIND_INFO[kind]
  return side === 'either' || side === sideOfType(type)
}

/** The kinds an owner may pick for an account of this type. */
export function kindsForType(type: string): AccountKind[] {
  return ACCOUNT_KINDS.filter((kind) => kindFitsType(kind, type))
}

/** The owner's pick of kind if it fits an account of this type, otherwise none. */
export function choiceThatFits(choice: AccountKind | null, type: string): AccountKind | null {
  return choice && kindFitsType(choice, type) ? choice : null
}

/**
 * The kind an account counts as: the owner's pick when it fits the account,
 * otherwise the automatic one. A pick that no longer fits quietly falls back
 * rather than misleading; changing a manual account's type also clears it.
 */
export function kindOf(account: ClassifiableAccount & { kindChoice: AccountKind | null }) {
  return choiceThatFits(account.kindChoice, account.type) ?? automaticKind(account)
}
