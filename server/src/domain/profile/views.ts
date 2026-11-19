// The savings view that summarize_savings returns, built from the financial
// profile: the whole picture, then one lens per savings kind (see lens.ts for
// the four parts every lens shares). Each lens comes fully worked out, so
// whatever shows it never has to work anything out again.

import { isSavingsKind, KIND_INFO, SAVINGS_KINDS, type SavingsKind } from '../accountKinds.js'
import type { BankContributions } from '../savings/contributions.js'
import type { EmergencyFund } from '../savings/emergency.js'
import type { BalancePoint } from '../savings/history.js'
import type { SavingsRate } from '../savings/rate.js'
import type { CombinedChanges, SavingsAccount, SavingsKindReport } from '../savings/report.js'
import type { RetirementPlan } from '../retirement/plan.js'
import type { IsoDate } from '../../lib/dates.js'
import { savingsInsights, type Insight, type InsightFormat } from './insights.js'
import type { Lens } from './lens.js'
import { investingLens, savingsLens, type LensInput } from './lenses.js'
import type { FinancialProfile, ProfileGoal } from './profile.js'
import { pensionCards, retirementLens, type PensionCard } from './retirementLens.js'

/** Each savings kind's lens builder. */
const LENS_BUILDERS: { [K in SavingsKind]: (input: LensInput) => Lens<K> } = {
  savings: savingsLens,
  retirement: retirementLens,
  investment: investingLens,
}

/** One savings kind's lens, with the detail that goes beside the four parts. */
export interface SavingsLens extends Lens<SavingsKind> {
  totalCents: number
  changes: CombinedChanges
  /** This kind's total over time, oldest first, ending today. */
  history: BalancePoint[]
  /** Part 4: the accounts behind the lens. */
  accounts: SavingsAccount[]
  goals: ProfileGoal[]
  /** Every insight about this kind, the lens's pick among them. */
  insights: Insight[]
  /** For the savings lens only; null elsewhere and when it cannot be worked out. */
  emergencyFund: EmergencyFund | null
  /** For the retirement lens only: the projection, its assumptions and the pensions. */
  retirement: RetirementPlan | null
  /** For the retirement lens only: a card per pension, entered by the owner. */
  pensions: PensionCard[]
}

/** Savings and investments as a whole, then a lens per kind the owner has. */
export interface SavingsView {
  hasSavings: boolean
  currency: string
  totalCents: number
  changes: CombinedChanges
  historyStartsOn: IsoDate | null
  history: BalancePoint[]
  savingsRate: SavingsRate | null
  savingsRateTargetPercent: number | null
  contributions: BankContributions | null
  /** Insights about the whole picture rather than one kind. */
  insights: Insight[]
  lenses: SavingsLens[]
}

/**
 * The lens a goal belongs in: the kind of the account it follows when that is
 * a savings kind, otherwise savings, where goals counted by hand live.
 */
export function goalLens(goal: ProfileGoal): SavingsKind {
  return goal.accountKind && isSavingsKind(goal.accountKind) ? goal.accountKind : 'savings'
}

const NO_CHANGES = { month: null, days30: null, year: null, all: null }

/**
 * The kinds to show a lens for: each kind with accounts, and retirement when
 * there is a pension or a birth year to project from, even with no
 * retirement account yet.
 */
export function lensKinds(profile: FinancialProfile): SavingsKindReport[] {
  const { kinds } = profile.savings
  const { hasPension, assumptions } = profile.retirement
  const wantsRetirement = hasPension || assumptions.birthYear !== null
  if (!wantsRetirement || kinds.some((k) => k.kind === 'retirement')) return kinds
  const empty: SavingsKindReport = {
    kind: 'retirement',
    label: KIND_INFO.retirement.label,
    totalCents: 0,
    changes: NO_CHANGES,
    history: [],
    accounts: [],
  }
  return SAVINGS_KINDS.flatMap((kind) =>
    kind === 'retirement' ? [empty] : kinds.filter((k) => k.kind === kind),
  )
}

export function savingsView(profile: FinancialProfile, format: InsightFormat): SavingsView {
  const { savings } = profile
  const goalsOf = (kind: SavingsKind) => profile.goals.filter((goal) => goalLens(goal) === kind)
  const insights = savingsInsights(profile, format, goalsOf)
  const overall = insights.filter((insight) => insight.about === 'overall')

  const lenses = lensKinds(profile).map<SavingsLens>((report) => {
    const own = insights.filter((insight) => insight.about === report.kind)
    // A lens may cite an overall fact, such as contributions, when it has none of its own.
    const lens = LENS_BUILDERS[report.kind]({
      profile,
      report,
      insights: [...own, ...overall],
      format,
    })
    return {
      ...lens,
      totalCents: report.totalCents,
      changes: report.changes,
      history: report.history,
      accounts: report.accounts,
      goals: goalsOf(report.kind),
      insights: own,
      emergencyFund: report.kind === 'savings' ? profile.emergencyFund : null,
      retirement: report.kind === 'retirement' ? profile.retirement : null,
      pensions: report.kind === 'retirement' ? pensionCards(profile.retirement, format) : [],
    }
  })

  return {
    hasSavings: savings.hasSavings,
    currency: savings.currency,
    totalCents: savings.totalCents,
    changes: savings.changes,
    historyStartsOn: savings.historyStartsOn,
    history: savings.history,
    savingsRate: profile.savingsRate,
    savingsRateTargetPercent: profile.savingsRateTargetPercent,
    contributions: savings.contributions,
    insights: overall,
    lenses,
  }
}
