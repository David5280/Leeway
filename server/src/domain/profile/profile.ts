/**
 * The financial profile: everything Leeway knows about the owner's money, in
 * one typed object, worked out fresh from the stored data on every read so it
 * is never out of date. Nothing here is stored.
 *
 * It is the single source for anything that speaks about the owner's whole
 * picture: the per-kind views on the Savings page (views.ts), the rule-based
 * insights (insights.ts), the short digest an AI assistant reads (digest.ts),
 * the check-in, the dashboard summary and the weekly email. Each of those
 * reads from here, so a number is worked out once and reads the same
 * everywhere.
 *
 * Sources, and where each is worked out:
 * - accounts and their kinds: accounts.ts and accountKinds.ts
 * - balances over time and contributions: savings/report.ts
 * - pay schedule and a typical month of income and spending: income.ts
 * - bills: bills.ts; goals: goals.ts
 * - the emergency fund and savings rate: savings/emergency.ts, savings/rate.ts
 *
 * userContext is where life context the owner writes in their own words will
 * go (and facts an assistant proposes once the owner approves them). It is
 * always empty until that editor exists; nothing fills it on its own.
 */

import type { Db } from '../../db/pool.js'
import type { IsoDate } from '../../lib/dates.js'
import { ACCOUNT_KINDS, KIND_INFO, type AccountKind } from '../accountKinds.js'
import { listAccounts, type Account } from '../accounts.js'
import { listBills } from '../bills.js'
import { listGoals, type Goal } from '../goals.js'
import { emergencyFund, type EmergencyFund } from '../savings/emergency.js'
import { savingsRate, type SavingSource, type SavingsRate } from '../savings/rate.js'
import { getSavingsReport, type SavingsReport } from '../savings/report.js'
import { periodConfig, type Settings } from '../settings.js'
import { monthlyAverages, paySchedule, type MonthlyAverages, type PaySchedule } from './income.js'

/** The owner's accounts of one kind, added up. */
export interface KindSummary {
  kind: AccountKind
  label: string
  accounts: number
  /** Balances in the owner's currency; for cards and loans, what is owed. */
  totalCents: number
  /** Accounts with no balance yet or in another currency, left out of the total. */
  notCounted: number
}

/** A goal as the profile tells it, with the kind of account it follows, if any. */
export interface ProfileGoal {
  id: string
  name: string
  kind: Goal['kind']
  /** The kind of the account the goal follows, or null for one counted by hand. */
  accountKind: AccountKind | null
  percent: number
  currentCents: number
  targetCents: number
  remainingCents: number
  targetDate: IsoDate | null
  /** When the recent pace reaches the target; null without recent progress or once reached. */
  projectedDate: IsoDate | null
  onTrack: boolean | null
  status: Goal['status']
}

export interface FinancialProfile {
  asOf: IsoDate
  currency: string
  locale: string
  pay: PaySchedule
  /** A typical month of income and spending, from the last whole months. */
  monthly: MonthlyAverages
  bills: { count: number; monthlyCents: number }
  /** Every kind the owner has an account of, in the standard order. */
  accounts: KindSummary[]
  savings: SavingsReport
  emergencyFund: EmergencyFund | null
  savingsRate: SavingsRate | null
  /** The share of pay the owner aims to save, or null for no target. */
  savingsRateTargetPercent: number | null
  goals: ProfileGoal[]
  /** Life context in the owner's own words. Empty until the owner can add it. */
  userContext: string[]
}

/** Each kind's accounts added up; only kinds the owner has, in the standard order. */
export function kindSummaries(accounts: Account[], currency: string): KindSummary[] {
  return ACCOUNT_KINDS.flatMap((kind) => {
    const ofKind = accounts.filter((a) => a.kind === kind)
    if (ofKind.length === 0) return []
    const counted = ofKind.filter((a) => a.balanceCents !== null && a.currency === currency)
    return [
      {
        kind,
        label: KIND_INFO[kind].label,
        accounts: ofKind.length,
        totalCents: counted.reduce((sum, a) => sum + a.balanceCents!, 0),
        notCounted: ofKind.length - counted.length,
      },
    ]
  })
}

function profileGoal(goal: Goal, accounts: Account[]): ProfileGoal {
  const account = accounts.find((a) => a.id === goal.accountId)
  return {
    id: goal.id,
    name: goal.name,
    kind: goal.kind,
    accountKind: account?.kind ?? null,
    percent: goal.percent,
    currentCents: goal.currentCents,
    targetCents: goal.targetCents,
    remainingCents: goal.remainingCents,
    targetDate: goal.targetDate,
    projectedDate: goal.projectedDate,
    onTrack: goal.onTrack,
    status: goal.status,
  }
}

/** The streams of saving Leeway can see, for the savings rate. */
export function savingSources(savings: SavingsReport): SavingSource[] {
  const monthly = savings.contributions?.monthlyCents
  if (!monthly) return []
  return [
    { label: 'Transfers to savings', monthlyCents: monthly.cash, beforePaycheck: false },
    {
      label: 'Transfers to investment and retirement accounts',
      monthlyCents: monthly.invested,
      beforePaycheck: false,
    },
  ]
}

/** What the emergency fund and the savings rate are worked out from. */
export interface SavingsMeasuresInput {
  savings: SavingsReport
  monthly: MonthlyAverages
  /** Tracked bills a month, the stand-in for essentials before a whole month is held. */
  billsMonthlyCents: number
  settings: Pick<Settings, 'savingsPlan'>
  today: IsoDate
}

export interface SavingsMeasures {
  emergencyFund: EmergencyFund | null
  savingsRate: SavingsRate | null
}

/**
 * The emergency fund and the savings rate, from data already read. Pure, so
 * the check-in can work them out from its own reads without building the
 * whole profile.
 */
export function savingsMeasures({
  savings,
  monthly,
  billsMonthlyCents,
  settings,
  today,
}: SavingsMeasuresInput): SavingsMeasures {
  const cash = savings.kinds.find((k) => k.kind === 'savings')
  // Without a whole month of spending, the bills are the best measure of essentials.
  const essentials = monthly.essentialSpendingCents ?? (billsMonthlyCents || null)
  return {
    emergencyFund: cash
      ? emergencyFund({
          savedCents: cash.totalCents,
          monthlyEssentialsCents: essentials,
          essentialsFrom: monthly.essentialSpendingCents === null ? 'bills' : 'spending',
          targetMonths: settings.savingsPlan.emergencyFundMonths,
          monthlyPaceCents: savings.contributions?.monthlyCents?.cash ?? null,
          today,
        })
      : null,
    savingsRate: savingsRate(monthly.incomeCents, savingSources(savings)),
  }
}

/** The whole financial picture as of today. */
export async function getFinancialProfile(
  db: Db,
  settings: Settings,
  today: IsoDate,
): Promise<FinancialProfile> {
  // One at a time: db may be a transaction's client, which runs one query at once.
  const accounts = await listAccounts(db, false)
  const savings = await getSavingsReport(db, settings, today)
  const monthly = await monthlyAverages(db, settings, today)
  const pay = await paySchedule(db, settings, today)
  const bills = await listBills(db, today)
  const goals = await listGoals(db, { today, period: periodConfig(settings) })

  const billsMonthlyCents = bills.reduce((sum, bill) => sum + bill.monthlyCents, 0)
  return {
    asOf: today,
    currency: settings.currency,
    locale: settings.locale,
    pay,
    monthly,
    bills: { count: bills.length, monthlyCents: billsMonthlyCents },
    accounts: kindSummaries(accounts, settings.currency),
    savings,
    ...savingsMeasures({ savings, monthly, billsMonthlyCents, settings, today }),
    savingsRateTargetPercent: settings.savingsPlan.savingsRateTargetPercent,
    goals: goals.map((goal) => profileGoal(goal, accounts)),
    userContext: [],
  }
}
