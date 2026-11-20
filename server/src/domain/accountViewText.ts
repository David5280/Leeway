// The Accounts dashboard's figures and words for a pick of accounts: their
// balances added up, spending by category, and a short summary. Pure: the
// accounts and totals come in, nothing is read here.

import type { IsoDate } from '../lib/dates.js'
import type { AccountAlert } from './accountAlerts.js'
import type { Account } from './accounts.js'
import type { CategoryTotal } from './budget.js'
import type { Category } from './categories.js'
import { MAX_POINTS, type SummaryText } from './summaryText.js'

type Money = (cents: number) => string

/** What a balance needs, for adding several up. */
export type BalanceAccount = Pick<
  Account,
  'name' | 'type' | 'balanceCents' | 'availableCents' | 'creditLimitCents'
>

/** Several accounts' balances added up. Cards and loans count as owed. */
export interface CombinedBalances {
  /** Checking and savings, as the bank last posted them. */
  cashCents: number
  /** Checking and savings that can be spent now: the available balance where the bank sends one. */
  availableCents: number
  /** Owed on cards and loans. */
  owedCents: number
  /** The limits of the cards whose limit is known; null when none is. */
  creditLimitCents: number | null
  /** What those cards could still be charged; null when no limit is known. */
  creditLeftCents: number | null
  /** Investments, property and anything else owned. */
  otherCents: number
  /** Everything owned less everything owed. */
  netCents: number
  /** How many of the accounts are checking or savings, cards or loans, and anything else. */
  cashAccounts: number
  debtAccounts: number
  otherAccounts: number
}

/** Money in and out of the picked accounts over one budget period. */
export interface PeriodFlow {
  start: IsoDate
  /** The period's last day (inclusive). */
  end: IsoDate
  inCents: number
  outCents: number
}

/** Spending in one category, for the picked accounts. */
export interface CategorySpending {
  /** Null for spending that has no category yet. */
  categoryId: string | null
  name: string
  color: string | null
  spentCents: number
}

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0)

export function combineBalances(accounts: BalanceAccount[]): CombinedBalances {
  const cash = accounts.filter((a) => a.type === 'depository')
  const debts = accounts.filter((a) => a.type === 'credit' || a.type === 'loan')
  const other = accounts.filter((a) => !cash.includes(a) && !debts.includes(a))
  const balance = (a: BalanceAccount) => a.balanceCents ?? 0
  // Only cards whose limit is known say how much credit is left.
  const limited = debts.filter((a) => a.type === 'credit' && a.creditLimitCents)
  const creditLimitCents = limited.length ? sum(limited.map((a) => a.creditLimitCents!)) : null

  const cashCents = sum(cash.map(balance))
  const owedCents = sum(debts.map(balance))
  const otherCents = sum(other.map(balance))
  return {
    cashCents,
    availableCents: sum(cash.map((a) => a.availableCents ?? balance(a))),
    owedCents,
    creditLimitCents,
    creditLeftCents:
      creditLimitCents === null ? null : creditLimitCents - sum(limited.map(balance)),
    otherCents,
    netCents: cashCents + otherCents - owedCents,
    cashAccounts: cash.length,
    debtAccounts: debts.length,
    otherAccounts: other.length,
  }
}

/**
 * Spending by category, biggest first: expense categories and spending not
 * yet filed, each counted net of refunds. Income, and anything that came out
 * as money in on balance, is left out.
 */
export function spendingByCategory(
  totals: CategoryTotal[],
  categories: Pick<Category, 'id' | 'name' | 'color' | 'kind'>[],
): CategorySpending[] {
  const byId = new Map(categories.map((c) => [c.id, c]))
  const spending: CategorySpending[] = []
  for (const total of totals) {
    if (total.amountCents <= 0) continue
    if (total.categoryId === null) {
      spending.push({
        categoryId: null,
        name: 'Needs a category',
        color: null,
        spentCents: total.amountCents,
      })
      continue
    }
    const category = byId.get(total.categoryId)
    if (category?.kind !== 'expense') continue
    spending.push({
      categoryId: category.id,
      name: category.name,
      color: category.color,
      spentCents: total.amountCents,
    })
  }
  return spending.sort((a, b) => b.spentCents - a.spentCents)
}

/** What the summary is worked out from. */
export interface AccountsSummaryInput {
  /** The picked accounts the bank still shares, whose balances are added up. */
  accounts: Pick<Account, 'name'>[]
  /** The picked accounts no longer shared, left out of the figures (unshared.ts). */
  unshared: Pick<Account, 'name' | 'institutionName'>[]
  balances: CombinedBalances
  /** Oldest first; the last is the current period. */
  flows: PeriodFlow[]
  spending: CategorySpending[]
  alerts: AccountAlert[]
  /** The everyday word for a budget period: "month", "week" or "paycheck". */
  periodWord: string
}

/** Where the picked accounts stand, in one sentence: an urgent alert first, then the money. */
function headline(input: AccountsSummaryInput, money: Money): string {
  const urgent = input.alerts.find((alert) => alert.severity === 'urgent')
  if (urgent) return urgent.message
  const { balances, accounts, unshared } = input
  if (accounts.length === 0 && unshared.length > 0) return onlyUnsharedHeadline(unshared)
  if (accounts.length === 0) return 'No accounts yet. Connect a bank or add one in Settings.'
  const only = accounts.length === 1 ? accounts[0]!.name : null
  if (balances.cashAccounts > 0) {
    const where =
      only ??
      plural(balances.cashAccounts, 'checking or savings account', 'checking and savings accounts')
    return `${money(balances.availableCents)} available ${only ? 'in' : 'across'} ${where}.`
  }
  if (balances.debtAccounts > 0) {
    const where = only
      ? `on ${only}`
      : `across ${plural(balances.debtAccounts, 'card or loan', 'cards and loans')}`
    return `${money(balances.owedCents)} owed ${where}.`
  }
  return `${money(balances.netCents)} in ${only ?? plural(accounts.length, 'account', 'accounts')}.`
}

/** Where the bank shares none of the picked accounts, there is no balance to give. */
function onlyUnsharedHeadline(unshared: AccountsSummaryInput['unshared']): string {
  const [only] = unshared
  if (unshared.length === 1) {
    return `${only!.name} is no longer shared from ${bankOf(only!)}, so it has no current balance.`
  }
  return 'These accounts are no longer shared from their banks, so they have no current balances.'
}

/** Accounts no longer shared among shared ones, so the figures are not read as covering them. */
function unsharedPoint({ accounts, unshared }: AccountsSummaryInput): string | null {
  if (accounts.length === 0 || unshared.length === 0) return null
  if (unshared.length > 1) {
    return `${unshared.length} accounts no longer shared from their banks are left out of these figures.`
  }
  const [only] = unshared
  return `${only!.name} is no longer shared from ${bankOf(only!)} and is left out of these figures.`
}

const bankOf = (account: Pick<Account, 'institutionName'>) => account.institutionName ?? 'its bank'

/** "1 card or loan", "2 cards or loans". */
function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`
}

/** Debt alongside cash, so the cash figure is not read as all spare. */
function owedPoint({ balances }: AccountsSummaryInput, money: Money): string | null {
  if (balances.cashAccounts === 0 || balances.owedCents <= 0) return null
  return `${money(balances.owedCents)} is owed on cards and loans.`
}

function creditPoint({ balances }: AccountsSummaryInput, money: Money): string | null {
  // A card past its limit has its own alert, so only room left is worth a line.
  if (balances.creditLeftCents === null || balances.creditLeftCents < 0) return null
  return `${money(balances.creditLeftCents)} of ${money(balances.creditLimitCents!)} in credit is unused.`
}

function flowPoint(flow: PeriodFlow | undefined, lead: string, money: Money): string | null {
  if (!flow || (flow.inCents === 0 && flow.outCents === 0)) return null
  return `${lead}, ${money(flow.inCents)} came in and ${money(flow.outCents)} went out.`
}

function topCategoryPoint({ spending, periodWord }: AccountsSummaryInput, money: Money) {
  const top = spending.find((s) => s.categoryId !== null)
  if (!top) return null
  return `The most spending this ${periodWord} went to ${top.name}, ${money(top.spentCents)}.`
}

/** The picked accounts in plain words: a headline and up to MAX_POINTS points. */
export function accountsSummary(input: AccountsSummaryInput, money: Money): SummaryText {
  const current = input.flows[input.flows.length - 1]
  const previous = input.flows[input.flows.length - 2]
  const points = [
    unsharedPoint(input),
    owedPoint(input, money),
    creditPoint(input, money),
    flowPoint(current, `So far this ${input.periodWord}`, money),
    flowPoint(previous, `Last ${input.periodWord}`, money),
    topCategoryPoint(input, money),
  ].filter((point): point is string => point !== null)
  return { headline: headline(input, money), points: points.slice(0, MAX_POINTS) }
}
