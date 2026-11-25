// Drill-downs for accounts: one account's balance (its detail page and its
// card) and a picked few (the Accounts screen's Select mode). Pure, from data Leeway
// already has: balances, recent daily balances, transactions and alerts.

import type { Account, Transaction } from '../../api/client'
import { combine, utilization, UTILIZATION_WATCH } from '../accountCards'
import { accountDetailPath } from '../accounts'
import { addDays } from '../dates'
import type { DrillDown, DrillItem, DrillTrend, DrillUsual, MathTerm } from '../drill'
import { paths } from '../../routes'

/**
 * Daily balances, oldest first and ending today, as dated points for the
 * trend, with where the balance should be (lib/accountDetail.ts) when known.
 */
export function balanceTrend(
  balances: readonly number[],
  today: string,
  name: string,
  reference: DrillTrend['reference'] | null = null,
): DrillTrend | undefined {
  if (balances.length < 2) return undefined
  const first = addDays(today, -(balances.length - 1))
  return {
    points: balances.map((cents, index) => ({ date: addDays(first, index), cents })),
    label: `Balance over the last ${balances.length} days`,
    description: `${name}'s balance each day for the last ${balances.length} days, today last.`,
    reference: reference ?? undefined,
  }
}

/** The average of a run of balances, in whole cents; null for none. */
export function averageOf(balances: readonly number[]): number | null {
  if (balances.length === 0) return null
  return Math.round(balances.reduce((sum, cents) => sum + cents, 0) / balances.length)
}

/** The balance against its own average over the days shown: up is good unless it is owed. */
function usualBalance(account: Account, balances: readonly number[]): DrillUsual | undefined {
  const average = averageOf(balances)
  if (average === null || account.balanceCents === null || balances.length < 7) return undefined
  const owed = account.type === 'credit' || account.type === 'loan'
  return {
    currentCents: account.balanceCents,
    usualCents: average,
    goodWhen: owed ? 'down' : 'up',
    basis: `its ${balances.length}-day average`,
  }
}

/** The math behind an account's balance, by kind: what is available, or what is left to use. */
function balanceMath(account: Account): DrillDown['math'] {
  const balance = account.balanceCents ?? 0
  if (account.type === 'credit' && account.creditLimitCents !== null) {
    const used = utilization(account)
    return {
      terms: [
        { label: 'Credit limit', value: { cents: account.creditLimitCents } },
        { label: 'owed now', value: { cents: balance }, op: 'minus' },
      ],
      result: { label: 'Credit left to use', value: { cents: account.creditLimitCents - balance } },
      note:
        used === null
          ? undefined
          : `Using ${used}% of the limit. Under ${UTILIZATION_WATCH}% is kinder to a credit score.`,
    }
  }
  if (account.availableCents !== null && account.availableCents !== balance) {
    const owed = account.type === 'credit' || account.type === 'loan'
    return {
      terms: [
        { label: 'Balance at the bank', value: { cents: balance } },
        {
          label: 'held for pending charges',
          value: { cents: balance - account.availableCents },
          op: 'minus',
        },
      ],
      result: {
        label: owed ? 'Owed after pending' : 'Available now',
        value: { cents: account.availableCents },
      },
    }
  }
  const terms: MathTerm[] = [{ label: 'Balance the bank reports', value: { cents: balance } }]
  return {
    terms,
    result: {
      label: account.type === 'credit' || account.type === 'loan' ? 'Owed' : 'Balance',
      value: {
        cents: balance,
        tone: balance < 0 && account.type === 'depository' ? 'problem' : undefined,
      },
    },
    note: account.manual ? 'You keep this balance up to date by hand.' : undefined,
  }
}

/** A transaction as a drill-down row, dated in words, that opens Activity on this account. */
function transactionItem(
  tx: Transaction,
  accountId: string,
  date: (iso: string) => string,
): DrillItem {
  return {
    key: tx.id,
    label: tx.displayName,
    detail: date(tx.date),
    value: { cents: tx.amountCents, sign: 'transaction' },
    to: paths.activity({ account: accountId }),
  }
}

/** One account: its balance's math, its last 30 days, against its average, and its newest activity. */
export function accountDrill(
  account: Account,
  {
    balances = [],
    recent = [],
    today,
    reference = null,
    date = (iso) => iso,
  }: {
    balances?: readonly number[]
    recent?: readonly Transaction[]
    today: string
    /** Where the balance should be, drawn on its trend. */
    reference?: DrillTrend['reference'] | null
    /** A transaction's date in words; the ISO date by default. */
    date?: (iso: string) => string
  },
): DrillDown {
  return {
    title: account.name,
    subtitle: account.institutionName ?? undefined,
    figure: {
      cents: account.balanceCents ?? 0,
      tone:
        (account.balanceCents ?? 0) < 0 && account.type === 'depository' ? 'problem' : undefined,
    },
    math: balanceMath(account),
    trend: balanceTrend(balances, today, account.name, reference),
    usual: usualBalance(account, balances),
    items:
      recent.length > 0
        ? {
            title: 'Recent activity',
            rows: recent.map((tx) => transactionItem(tx, account.id, date)),
          }
        : undefined,
    more: {
      to: paths.activity({ account: account.id }),
      label: 'See all activity',
    },
  }
}

/** Accounts as rows that open their own pages. */
function accountItems(accounts: readonly Account[]): DrillItem[] {
  return accounts.map((account) => ({
    key: account.id,
    label: account.name,
    detail: account.institutionName ?? undefined,
    value:
      account.balanceCents === null
        ? { text: 'No balance' }
        : {
            cents: account.balanceCents,
            tone: account.type === 'depository' && account.balanceCents < 0 ? 'problem' : undefined,
          },
    to: accountDetailPath(account.id),
  }))
}

/** What a set of accounts comes to: owned, less owed. */
function combinedMath(accounts: readonly Account[]): DrillDown['math'] {
  const { ownedCents, owedCents, netCents } = combine(accounts)
  return {
    terms: [
      { label: 'Owned in these accounts', value: { cents: ownedCents } },
      { label: 'owed on cards and loans', value: { cents: owedCents }, op: 'minus' },
    ],
    result: {
      label: 'Together',
      value: { cents: netCents, tone: netCents < 0 ? 'problem' : undefined },
    },
  }
}

/** The accounts picked in Select mode, added up. */
export function selectionDrill(accounts: readonly Account[]): DrillDown {
  const count = accounts.length
  return {
    title: `${count} ${count === 1 ? 'account' : 'accounts'} together`,
    figure: { cents: combine(accounts).netCents },
    math: combinedMath(accounts),
    items: { title: 'Picked', rows: accountItems(accounts) },
  }
}
