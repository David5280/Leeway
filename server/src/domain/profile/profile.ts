/**
 * The financial profile: everything Leeway knows about the owner's money, in
 * one typed object, worked out fresh from the stored data on every read so it
 * is never out of date. Nothing here is stored.
 *
 * It is the source for what speaks about the owner's whole picture: the
 * per-kind savings view (views.ts), the rule-based insights (insights.ts) and
 * the short digest an AI assistant reads (digest.ts). The check-in, which the
 * dashboard summary and the weekly email read, needs only a glance at savings,
 * so it reads that much and works out the emergency fund and savings rate
 * with the same savingsMeasures, and the numbers read the same everywhere.
 *
 * Sources, and where each is worked out:
 * - accounts and their kinds: accounts.ts and accountKinds.ts
 * - balances over time and contributions: savings/report.ts
 * - pay schedule and a typical month of income and spending: income.ts, which
 *   reads pay from the current employer's paychecks (pay/current.ts)
 * - bills: bills.ts; goals: goals.ts
 * - the emergency fund and savings rate: savings/emergency.ts, savings/rate.ts
 * - pensions and the retirement projection: retirement/pensions.ts, retirement/plan.ts
 *
 * userContext is where life context the owner writes in their own words will
 * go (and facts an assistant proposes once the owner approves them). It is
 * always empty until that editor exists; nothing fills it on its own.
 */

import type { Db } from '../../db/pool.js'
import type { IsoDate } from '../../lib/dates.js'
import { ACCOUNT_KINDS, KIND_INFO, type AccountKind, type SavingsKind } from '../accountKinds.js'
import { listAccounts, type Account } from '../accounts.js'
import { listBills } from '../bills.js'
import { listGoals, type Goal } from '../goals.js'
import { latestPaystub } from '../paystubs/paystubs.js'
import { pensionMonthlyTotals, type PensionMonthlyTotals } from '../retirement/pensions.js'
import { pensionsOf } from '../retirement/pensionStore.js'
import { retirementPlan, type RetirementPlan } from '../retirement/plan.js'
import { emergencyFund, type EmergencyFund } from '../savings/emergency.js'
import { paystubPlan } from '../savings/payrollMonths.js'
import {
  payrollSources,
  savingsRate,
  type SavingSource,
  type SavingsRate,
} from '../savings/rate.js'
import type { BankContributions } from '../savings/contributions.js'
import { cashSaved, getSavingsReport, type SavingsReport } from '../savings/report.js'
import { periodConfig, type Settings } from '../settings.js'
import { typicalMonth, type MonthlyAverages, type PaySchedule } from './income.js'

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
  /** For a stale goal, the day its account stopped being shared, which its progress is as of. */
  balanceAsOf: IsoDate | null
}

export interface FinancialProfile {
  asOf: IsoDate
  currency: string
  locale: string
  pay: PaySchedule
  /** A typical month: pay from the current employer, and recent spending (see income.ts). */
  monthly: MonthlyAverages
  bills: { count: number; monthlyCents: number }
  /** Every kind the owner has an account of, in the standard order. */
  accounts: KindSummary[]
  savings: SavingsReport
  emergencyFund: EmergencyFund | null
  savingsRate: SavingsRate | null
  /** The share of pay the owner aims to save, or null for no target. */
  savingsRateTargetPercent: number | null
  /** What pensions take from pay a month and what employers add, as far as known. */
  pensionPay: PensionMonthlyTotals
  /** Pensions and what savings and pensions could pay in retirement. */
  retirement: RetirementPlan
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
    balanceAsOf: goal.balanceAsOf,
  }
}

/**
 * The streams of saving Leeway can see, for the savings rate: transfers the
 * bank shows, the pension contributions the owner entered, and the 401(k),
 * 457 or 403(b) a recent paystub shows. The last two leave pay before the bank
 * sees it. An employer's share is not the owner's pay, so it is left out.
 */
export function savingSources(
  contributions: BankContributions | null,
  pensionMonthlyCents: number | null,
  planMonthlyCents: number | null = null,
): SavingSource[] {
  const monthly = contributions?.monthlyCents
  const bank: SavingSource[] = monthly
    ? [
        { label: 'Transfers to savings', monthlyCents: monthly.cash, beforePaycheck: false },
        {
          label: 'Transfers to investment and retirement accounts',
          monthlyCents: monthly.invested,
          beforePaycheck: false,
        },
      ]
    : []
  return [...bank, ...payrollSources(pensionMonthlyCents, planMonthlyCents)]
}

/** What the emergency fund and the savings rate are worked out from. */
export interface SavingsMeasuresInput {
  /** Cash in savings accounts, or null without any savings account. */
  cashCents: number | null
  contributions: BankContributions | null
  /** Pension contributions a month the owner entered, or null for none known. */
  pensionMonthlyCents: number | null
  /** The 401(k), 457 or 403(b) a month the newest saved paystub shows, or null. */
  planMonthlyCents?: number | null
  /** The plan the newest paystub shows but is too old to count, by name, or null. */
  stalePlan?: string | null
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
  cashCents,
  contributions,
  pensionMonthlyCents,
  planMonthlyCents = null,
  stalePlan = null,
  monthly,
  billsMonthlyCents,
  settings,
  today,
}: SavingsMeasuresInput): SavingsMeasures {
  const rate = savingsRate(
    monthly.incomeCents,
    savingSources(contributions, pensionMonthlyCents, planMonthlyCents),
  )
  // Without a whole month of spending, the bills are the best measure of essentials.
  const essentials = monthly.essentialSpendingCents ?? (billsMonthlyCents || null)
  return {
    emergencyFund:
      cashCents === null
        ? null
        : emergencyFund({
            savedCents: cashCents,
            monthlyEssentialsCents: essentials,
            essentialsFrom: monthly.essentialSpendingCents === null ? 'bills' : 'spending',
            targetMonths: settings.savingsPlan.emergencyFundMonths,
            monthlyPaceCents: contributions?.monthlyCents?.cash ?? null,
            today,
          }),
    savingsRate: rate && stalePlan ? { ...rate, stalePlan } : rate,
  }
}

/** The counted total of one kind of savings, or 0 without any account of it. */
function kindTotal(savings: SavingsReport, kind: SavingsKind): number {
  return savings.kinds.find((report) => report.kind === kind)?.totalCents ?? 0
}

/** The whole financial picture as of today. */
export async function getFinancialProfile(
  db: Db,
  settings: Settings,
  today: IsoDate,
): Promise<FinancialProfile> {
  // One at a time: db may be a transaction's client, which runs one query at once.
  const accounts = await listAccounts(db, false)
  const savings = await getSavingsReport(db, settings, today, accounts)
  const { monthly, pay } = await typicalMonth(db, settings, today)
  const bills = await listBills(db, today)
  const goals = await listGoals(db, { today, period: periodConfig(settings) })
  const pensions = await pensionsOf(db, accounts)
  const plan = paystubPlan(await latestPaystub(db), today)

  const billsMonthlyCents = bills.reduce((sum, bill) => sum + bill.monthlyCents, 0)
  const pensionPay = pensionMonthlyTotals(pensions, pay.cadence)
  const measures = savingsMeasures({
    cashCents: cashSaved(savings),
    contributions: savings.contributions,
    pensionMonthlyCents: pensionPay.memberCents,
    planMonthlyCents: plan.monthlyCents,
    stalePlan: plan.stale,
    monthly,
    billsMonthlyCents,
    settings,
    today,
  })
  const retirement = retirementPlan({
    today,
    assumptions: settings.retirement,
    retirementCents: kindTotal(savings, 'retirement'),
    investmentCents: kindTotal(savings, 'investment'),
    cashCents: cashSaved(savings),
    emergencyTargetCents: measures.emergencyFund?.targetCents ?? null,
    foundMonthlyContributionCents: savings.contributions?.monthlyCents?.invested ?? null,
    recentMonthlySpendingCents: monthly.spendingCents,
    pensions,
    payCadence: pay.cadence,
  })
  return {
    asOf: today,
    currency: settings.currency,
    locale: settings.locale,
    pay,
    monthly,
    bills: { count: bills.length, monthlyCents: billsMonthlyCents },
    accounts: kindSummaries(accounts, settings.currency),
    savings,
    ...measures,
    savingsRateTargetPercent: settings.savingsPlan.savingsRateTargetPercent,
    pensionPay,
    retirement,
    goals: goals.map((goal) => profileGoal(goal, accounts)),
    userContext: [],
  }
}
