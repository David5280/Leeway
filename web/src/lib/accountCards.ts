// What an account's card shows at a glance, by the kind of account it is:
// its group on the Accounts screen, its icon, and the one or two facts that
// matter for that kind. Pure, from data Leeway already has; a fact whose data
// is missing is left out rather than guessed.

import type { Account, Goal } from '../api/client'
import type { IconName } from '../components/ui'
import { isOwed, overdrawn } from './accounts'

export type AccountKind = Account['kind']

/** The groups on the Accounts screen, in order, each with its title and icon. */
export const ACCOUNT_GROUPS: { kind: AccountKind; title: string; icon: IconName }[] = [
  { kind: 'checking', title: 'Checking', icon: 'wallet' },
  { kind: 'credit_card', title: 'Credit cards', icon: 'card' },
  { kind: 'savings', title: 'Savings', icon: 'piggy' },
  { kind: 'investment', title: 'Investments', icon: 'growth' },
  { kind: 'retirement', title: 'Retirement', icon: 'sunrise' },
  { kind: 'loan', title: 'Loans', icon: 'loan' },
  { kind: 'other', title: 'Other', icon: 'accounts' },
]

/** The icon for an account of this kind. */
export function kindIcon(kind: AccountKind): IconName {
  return ACCOUNT_GROUPS.find((group) => group.kind === kind)?.icon ?? 'accounts'
}

/** Accounts sorted into the groups that have any, in the groups' order. */
export function groupAccounts<T extends Pick<Account, 'kind'>>(
  accounts: readonly T[],
): { kind: AccountKind; title: string; icon: IconName; accounts: T[] }[] {
  return ACCOUNT_GROUPS.map((group) => ({
    ...group,
    accounts: accounts.filter((account) => account.kind === group.kind),
  })).filter((group) => group.accounts.length > 0)
}

/** How much of a card's limit is used, as a whole percent; null without a limit or balance. */
export function utilization(
  account: Pick<Account, 'balanceCents' | 'creditLimitCents'>,
): number | null {
  if (account.creditLimitCents === null || account.creditLimitCents <= 0) return null
  if (account.balanceCents === null) return null
  return Math.round((Math.max(0, account.balanceCents) / account.creditLimitCents) * 100)
}

/** Above this share of a limit, card use starts to weigh on a credit score. */
export const UTILIZATION_WATCH = 30

/** The change across a run of daily balances, oldest first; null with fewer than two. */
export function balanceChange(balances: readonly number[]): number | null {
  if (balances.length < 2) return null
  return balances[balances.length - 1]! - balances[0]!
}

/** A fact on an account's card. Each carries words, never color alone. */
export type AccountFact =
  | { kind: 'ring'; label: string; percent: number; status: 'ok' | 'watch' | 'over' }
  | {
      kind: 'money'
      label: string
      cents: number
      tone?: 'in' | 'warn' | 'problem'
      sign?: 'change'
    }
  | { kind: 'text'; label: string; text: string; tone?: 'warn' | 'problem' }
  | { kind: 'spark'; label: string; values: number[] }

/** The goals that track this account's balance. */
export function goalsOn(account: Pick<Account, 'id'>, goals: readonly Goal[]): Goal[] {
  return goals.filter((goal) => goal.accountId === account.id)
}

/** The 30-day change as a fact; a rise is money in, so it is green with a +. */
function changeFacts(balances: readonly number[]): AccountFact[] {
  const change = balanceChange(balances)
  if (change === null) return []
  return [
    {
      kind: 'money',
      label: 'in 30 days',
      cents: change,
      sign: 'change',
      tone: change > 0 ? 'in' : undefined,
    },
  ]
}

/** Checking: overdrawn in words, else what is available after pending charges. */
function checkingFacts(account: Account, balances: readonly number[]): AccountFact[] {
  if (overdrawn(account)) {
    return [{ kind: 'text', label: 'Status', text: 'Overdrawn', tone: 'problem' }]
  }
  const { availableCents, balanceCents } = account
  if (availableCents !== null && balanceCents !== null && availableCents !== balanceCents) {
    return [{ kind: 'money', label: 'available', cents: availableCents }]
  }
  return changeFacts(balances)
}

/** How a card's use of its limit reads: over it, above the score-friendly share, or fine. */
export function utilizationStatus(percent: number): 'ok' | 'watch' | 'over' {
  if (percent > 100) return 'over'
  return percent > UTILIZATION_WATCH ? 'watch' : 'ok'
}

/** Credit card: how much of the limit is used, and the minimum payment. */
function creditFacts(account: Account): AccountFact[] {
  const facts: AccountFact[] = []
  const used = utilization(account)
  if (used !== null) {
    facts.push({
      kind: 'ring',
      label: 'of limit used',
      percent: used,
      status: utilizationStatus(used),
    })
  }
  if (account.minimumPaymentCents !== null) {
    facts.push({ kind: 'money', label: 'minimum due', cents: account.minimumPaymentCents })
  }
  return facts
}

/** Savings: the first goal's progress, else the change over the last 30 days. */
function savingsFacts(balances: readonly number[], goals: readonly Goal[]): AccountFact[] {
  const goal = goals.find((one) => one.targetCents > 0)
  if (!goal) return changeFacts(balances)
  return [{ kind: 'ring', label: goal.name, percent: goal.percent, status: 'ok' }]
}

/** Investment and retirement: the 30-day change and the line of it. */
function growthFacts(balances: readonly number[]): AccountFact[] {
  if (balances.length < 2) return []
  return [
    ...changeFacts(balances),
    { kind: 'spark', label: 'Balance over 30 days', values: [...balances] },
  ]
}

/** Loan: the rate and the monthly payment. */
function loanFacts(account: Account): AccountFact[] {
  const facts: AccountFact[] = []
  if (account.aprPercent !== null) {
    facts.push({ kind: 'text', label: 'rate', text: `${account.aprPercent}% APR` })
  }
  if (account.minimumPaymentCents !== null) {
    facts.push({ kind: 'money', label: 'a month', cents: account.minimumPaymentCents })
  }
  return facts
}

/**
 * The one or two facts that matter for an account of its kind. `balances`
 * are its daily balances for the last 30 days, oldest first; `goals` are the
 * goals that track it (goalsOn).
 */
export function accountFacts(
  account: Account,
  { balances = [], goals = [] }: { balances?: readonly number[]; goals?: readonly Goal[] } = {},
): AccountFact[] {
  switch (account.kind) {
    case 'checking':
      return checkingFacts(account, balances)
    case 'credit_card':
      return creditFacts(account)
    case 'savings':
      return savingsFacts(balances, goals)
    case 'investment':
    case 'retirement':
      return growthFacts(balances)
    case 'loan':
      return loanFacts(account)
    default:
      return changeFacts(balances)
  }
}

/**
 * What a set of accounts adds up to: what is owned, what is owed, and the
 * difference. A balance on the other side of zero counts on the other side,
 * as net worth counts it: an overpaid card is owned, an overdrawn account owed.
 */
export function combine(accounts: readonly Pick<Account, 'type' | 'balanceCents'>[]): {
  ownedCents: number
  owedCents: number
  netCents: number
} {
  let ownedCents = 0
  let owedCents = 0
  for (const account of accounts) {
    const balance = account.balanceCents ?? 0
    const held = isOwed(account) ? -balance : balance
    if (held >= 0) ownedCents += held
    else owedCents -= held
  }
  return { ownedCents, owedCents, netCents: ownedCents - owedCents }
}
