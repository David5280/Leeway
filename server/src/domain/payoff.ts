// Debt payoff plans: month by month, how long each debt takes to clear and
// what it costs in interest, under the avalanche or snowball strategy.
// Pure math, no I/O. It plans payments; it never makes them.

export interface Debt {
  id: string
  name: string
  /** What is owed now, positive. */
  balanceCents: number
  /** Yearly interest rate in basis points: 2499 is 24.99%. */
  aprBps: number
  /**
   * The required payment each month. Null for a credit card whose minimum is
   * unknown: the usual card formula (1% of the balance plus interest, at
   * least $25) is used instead.
   */
  minimumCents: number | null
}

/** Avalanche pays the highest rate first (least interest); snowball the smallest balance (quick wins). */
export type Strategy = 'avalanche' | 'snowball' | 'minimums'

export interface DebtOutcome {
  id: string
  name: string
  /** Months from now until it is paid off, or null if it never is within the plan's limit. */
  months: number | null
  interestCents: number
}

export interface PayoffPlan {
  strategy: Strategy
  /** Paid each month in total: every minimum plus the extra. */
  monthlyPaymentCents: number
  /** Months until every debt is paid, or null if that never happens within the limit. */
  months: number | null
  totalInterestCents: number
  /** In the order they get paid off. */
  debts: DebtOutcome[]
}

/** The plan stops here (50 years): a payment that barely beats interest never finishes. */
export const MAX_MONTHS = 600

const CARD_MINIMUM_FLOOR_CENTS = 2500

function monthlyInterest(balanceCents: number, aprBps: number): number {
  return Math.round((balanceCents * aprBps) / 10_000 / 12)
}

/** The minimum due this month, for a balance that already includes this month's interest. */
function minimumDue(debt: Debt, balanceCents: number, interestCents: number): number {
  const minimum =
    debt.minimumCents ??
    Math.max(CARD_MINIMUM_FLOOR_CENTS, Math.round(balanceCents * 0.01) + interestCents)
  return Math.min(minimum, balanceCents)
}

/** Debts in the order extra money goes to them; ties keep the original order. */
function targetOrder(debts: Debt[], strategy: Strategy): Debt[] {
  if (strategy === 'avalanche') return [...debts].sort((a, b) => b.aprBps - a.aprBps)
  if (strategy === 'snowball') return [...debts].sort((a, b) => a.balanceCents - b.balanceCents)
  return debts
}

/** The first month's minimums: what someone already has to pay. */
export function startingMinimums(debts: Debt[]): number {
  return debts.reduce((sum, debt) => {
    const interest = monthlyInterest(debt.balanceCents, debt.aprBps)
    return sum + minimumDue(debt, debt.balanceCents + interest, interest)
  }, 0)
}

/**
 * Simulates paying the debts. Each month interest is added, every debt gets
 * its minimum, and the rest of the monthly payment goes to the target debt
 * per the strategy, then the next. The monthly payment stays the same as
 * debts clear, so a paid-off debt's minimum rolls onto the next target.
 * With strategy "minimums" there is no extra and nothing rolls over.
 */
export function planPayoff(debts: Debt[], extraCents: number, strategy: Strategy): PayoffPlan {
  const order = targetOrder(debts, strategy)
  const balances = new Map(debts.map((d) => [d.id, d.balanceCents]))
  const interest = new Map(debts.map((d) => [d.id, 0]))
  const paidOffAt = new Map<string, number>()
  const budget = strategy === 'minimums' ? 0 : startingMinimums(debts) + extraCents

  for (let month = 1; month <= MAX_MONTHS && paidOffAt.size < debts.length; month++) {
    let spent = 0
    for (const debt of order) {
      const owed = balances.get(debt.id)!
      if (owed <= 0) continue
      const charge = monthlyInterest(owed, debt.aprBps)
      interest.set(debt.id, interest.get(debt.id)! + charge)
      const payment = minimumDue(debt, owed + charge, charge)
      balances.set(debt.id, owed + charge - payment)
      spent += payment
    }
    // Whatever is left of the monthly budget goes to targets in order.
    let extra = Math.max(0, budget - spent)
    for (const debt of order) {
      if (extra === 0) break
      const payment = Math.min(extra, balances.get(debt.id)!)
      balances.set(debt.id, balances.get(debt.id)! - payment)
      extra -= payment
    }
    for (const debt of order) {
      if (balances.get(debt.id)! <= 0 && !paidOffAt.has(debt.id)) paidOffAt.set(debt.id, month)
    }
  }

  const outcomes = order
    .map((debt) => ({
      id: debt.id,
      name: debt.name,
      months: paidOffAt.get(debt.id) ?? null,
      interestCents: interest.get(debt.id)!,
    }))
    .sort((a, b) => (a.months ?? Infinity) - (b.months ?? Infinity))
  const finished = paidOffAt.size === debts.length
  return {
    strategy,
    monthlyPaymentCents: strategy === 'minimums' ? startingMinimums(debts) : budget,
    months: finished ? Math.max(0, ...paidOffAt.values()) : null,
    totalInterestCents: outcomes.reduce((sum, o) => sum + o.interestCents, 0),
    debts: outcomes,
  }
}
