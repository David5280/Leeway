// What kind of account each one is: checking, savings, retirement, investing,
// credit card, loan or other. Worked out from the bank's account type and
// subtype (Plaid's names), unless the owner picked a kind. Every part of
// Leeway that treats accounts differently by kind asks this module. Pure, so
// the web app uses the very same rules.

/** Every kind, in the order accounts are listed. */
export const ACCOUNT_KINDS = [
  'checking',
  'savings',
  'retirement',
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
  investment: { label: 'Investing', noun: 'investment account', side: 'asset' },
  credit_card: { label: 'Credit cards', noun: 'credit card', side: 'liability' },
  loan: { label: 'Loans', noun: 'loan', side: 'liability' },
  other: { label: 'Other', noun: 'account', side: 'either' },
}

/** The kinds that hold money put away for later, shown on the Savings page in this order. */
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
  'pension',
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
const RETIREMENT_NAME = /\b(401\s?\(?k\)?|403\s?\(?b\)?|457\s?\(?b\)?|ira|roth|rollover|pension)\b/i

/** What classifying reads from an account. */
export interface ClassifiableAccount {
  type: string
  subtype: string | null
  /** The bank's name for the account, used only when the subtype says nothing. */
  bankName: string
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
      return SAVINGS_SUBTYPES.has(sub) ? 'savings' : 'checking'
    case 'investment':
      if (RETIREMENT_SUBTYPES.has(sub)) return 'retirement'
      if (NOT_INVESTED_SUBTYPES.has(sub)) return 'other'
      // A subtype Leeway knows (brokerage, 529, crypto exchange...) is investing;
      // an unknown or missing one may still be retirement, judging by its name.
      return RETIREMENT_NAME.test(bankName) ? 'retirement' : 'investment'
    default:
      return 'other'
  }
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
