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

/**
 * The one or two facts that matter for an account of its kind:
 * - checking: overdrawn in words, else what is available after pending charges;
 * - credit card: how much of the limit is used, and the minimum payment;
 * - savings: a goal's progress, else the change over the last 30 days;
 * - investment and retirement: the 30-day change and its line;
 * - loan: the rate and the monthly payment.
 */
export function accountFacts(
  account: Account,
  { balances = [], goals = [] }: { balances?: readonly number[]; goals?: readonly Goal[] } = {},
): AccountFact[] {
  const change = balanceChange(balances)
  const changeFact = (): AccountFact[] =>
    change === null
      ? []
      : [
          {
            kind: 'money',
            label: 'in 30 days',
            cents: change,
            sign: 'change',
            tone: change > 0 ? 'in' : undefined,
          },
        ]

  switch (account.kind) {
    case 'checking': {
      if (overdrawn(account))
        return [{ kind: 'text', label: 'Status', text: 'Overdrawn', tone: 'problem' }]
      const pending =
        account.availableCents !== null && account.balanceCents !== null
          ? account.balanceCents - account.availableCents
          : 0
      return account.availableCents !== null && pending !== 0
        ? [{ kind: 'money', label: 'available', cents: account.availableCents }]
        : changeFact()
    }
    case 'credit_card': {
      const used = utilization(account)
      const facts: AccountFact[] = []
      if (used !== null) {
        const status = used > 100 ? 'over' : used > UTILIZATION_WATCH ? 'watch' : 'ok'
        facts.push({ kind: 'ring', label: 'of limit used', percent: used, status })
      }
      if (account.minimumPaymentCents !== null) {
        facts.push({ kind: 'money', label: 'minimum due', cents: account.minimumPaymentCents })
      }
      return facts
    }
    case 'savings': {
      const goal = goals.find((one) => one.targetCents > 0)
      if (goal) {
        return [{ kind: 'ring', label: goal.name, percent: goal.percent, status: 'ok' }]
      }
      return changeFact()
    }
    case 'investment':
    case 'retirement':
      return balances.length > 1
        ? [...changeFact(), { kind: 'spark', label: 'Balance over 30 days', values: [...balances] }]
        : []
    case 'loan': {
      const facts: AccountFact[] = []
      if (account.aprPercent !== null) {
        facts.push({ kind: 'text', label: 'rate', text: `${account.aprPercent}% APR` })
      }
      if (account.minimumPaymentCents !== null) {
        facts.push({ kind: 'money', label: 'a month', cents: account.minimumPaymentCents })
      }
      return facts
    }
    default:
      return changeFact()
  }
}

/** What a set of accounts adds up to: what is owned, what is owed, and the difference. */
export function combine(accounts: readonly Pick<Account, 'type' | 'balanceCents'>[]): {
  ownedCents: number
  owedCents: number
  netCents: number
} {
  let ownedCents = 0
  let owedCents = 0
  for (const account of accounts) {
    const balance = account.balanceCents ?? 0
    if (isOwed(account)) owedCents += balance
    else ownedCents += balance
  }
  return { ownedCents, owedCents, netCents: ownedCents - owedCents }
}
