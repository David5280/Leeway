// The emergency fund goal: offered in one tap when there is none, sized from
// real essential spending (one month first, then three, then six), and
// following the savings accounts the owner marks for it, or every savings
// account until they do. Recording progress never moves money.

import type { Db } from '../db/pool.js'
import { AppError, isUniqueViolation, notFound } from '../errors.js'
import type { IsoDate } from '../lib/dates.js'
import { listAccounts, type Account } from './accounts.js'
import { listBills } from './bills.js'
import { listCategories } from './categories.js'
import {
  EMERGENCY_GOAL_NAME,
  FIRST_STEP_MONTHS,
  fundAccounts,
  fundBalance,
  fundCandidates,
  nextStepMonths,
  targetFor,
} from './emergencyPlan.js'
import { essentialIdsOf } from './essentials.js'
import { getGoal, listGoals, type Goal, type GoalClock } from './goals.js'
import { currentEssentials, monthlyAverages } from './profile/income.js'
import { periodConfig, type Settings } from './settings.js'

/** The color a new emergency fund is drawn in: a calm teal, never the red kept for problems. */
const EMERGENCY_COLOR = '#2fb3a6'

/** What essential spending a month comes to, and how Leeway knows. */
export interface MonthlyEssentials {
  cents: number
  /** Recent whole months of spending, or the bills while spending is too new to say. */
  from: 'spending' | 'bills'
  /** The categories counted as essential, by name; null when all spending counts. */
  categories: string[] | null
}

/** One account that can hold the fund, and whether the fund counts it now. */
export interface EmergencyAccount {
  id: string
  name: string
  balanceCents: number
  counted: boolean
}

/** The emergency fund as the Goals screen and an assistant read it. */
export interface EmergencyFundView {
  /** The goal, once started; null while it is only offered. */
  goalId: string | null
  /** Essential spending a month; null when not known yet (only possible once started). */
  essentials: MonthlyEssentials | null
  /** The step the fund aims for now, in months of essentials: 1 when offered. */
  months: number
  targetCents: number
  /** What the counted accounts hold. */
  savedCents: number
  /** The step after this one, or null at the last. */
  next: { months: number; targetCents: number } | null
  /** Every account that can hold the fund, marked or not. */
  accounts: EmergencyAccount[]
  /** Whether the owner marked accounts, rather than every savings account counting. */
  picked: boolean
}

/**
 * Essential spending in a typical month, from the last whole months, or the
 * tracked bills before a whole month is held; null when neither says.
 */
export async function monthlyEssentials(
  db: Db,
  settings: Settings,
  today: IsoDate,
): Promise<MonthlyEssentials | null> {
  // One at a time: db may be a transaction's client, which runs one query at once.
  const monthly = await monthlyAverages(db, settings, today)
  const categories = await listCategories(db)
  if (monthly.essentialSpendingCents) {
    const picked = currentEssentials(categories, settings.savingsPlan.essentialCategoryIds)
    const ids = essentialIdsOf(categories, picked)
    return {
      cents: monthly.essentialSpendingCents,
      from: 'spending',
      categories: ids && categories.filter((c) => ids.has(c.id)).map((c) => c.name),
    }
  }
  const bills = await listBills(db, today)
  const billsCents = bills.reduce((sum, bill) => sum + bill.monthlyCents, 0)
  return billsCents > 0 ? { cents: billsCents, from: 'bills', categories: null } : null
}

/** The marked accounts of the emergency fund goal. */
async function pickedIds(db: Db, goalId: string): Promise<string[]> {
  const { rows } = await db.query<{ id: string }>(
    'SELECT account_id AS id FROM goal_accounts WHERE goal_id = $1',
    [goalId],
  )
  return rows.map((row) => row.id)
}

/** Every account that can hold the fund, with whether it is counted now. */
function accountChoices(accounts: Account[], counted: string[], currency: string) {
  return fundCandidates(accounts, currency).map((a) => ({
    id: a.id,
    name: a.name,
    balanceCents: a.balanceCents!,
    counted: counted.includes(a.id),
  }))
}

/** The emergency fund goal, if the owner has one. */
async function emergencyGoal(db: Db, clock: GoalClock): Promise<Goal | null> {
  const goals = await listGoals(db, clock)
  return goals.find((goal) => goal.emergencyMonths !== null) ?? null
}

/**
 * The emergency fund: the goal once started, or the one-tap offer when there
 * is none. Null when there is no goal and essential spending is not known
 * yet, since there is nothing to size an offer by.
 */
export async function getEmergencyFund(
  db: Db,
  settings: Settings,
  today: IsoDate,
): Promise<EmergencyFundView | null> {
  const clock = { today, period: periodConfig(settings) }
  const goal = await emergencyGoal(db, clock)
  const essentials = await monthlyEssentials(db, settings, today)
  if (!goal && !essentials) return null
  const accounts = await listAccounts(db)
  const picked = goal ? await pickedIds(db, goal.id) : []
  const fund = fundAccounts(accounts, picked, settings.currency)
  const months = goal?.emergencyMonths ?? FIRST_STEP_MONTHS
  const next = nextStepMonths(months, settings.savingsPlan.emergencyFundMonths)
  return {
    goalId: goal?.id ?? null,
    essentials,
    months,
    targetCents: goal?.targetCents ?? targetFor(months, essentials!.cents),
    savedCents: goal ? goal.currentCents : fundBalance(fund.accounts),
    next:
      next === null || essentials === null
        ? null
        : { months: next, targetCents: targetFor(next, essentials.cents) },
    accounts: accountChoices(
      accounts,
      // A goal linked to one account in its form counts that account alone.
      goal?.accountId ? [goal.accountId] : fund.accounts.map((a) => a.id),
      settings.currency,
    ),
    picked: fund.picked,
  }
}

const noEssentials = () =>
  new AppError(
    'invalid_input',
    'Leeway needs a month of spending, or a bill, to size an emergency fund. Try again after your bank has synced a month.',
  )

/** Starts the emergency fund goal at one month of essential spending. */
export async function startEmergencyFund(
  db: Db,
  settings: Settings,
  today: IsoDate,
): Promise<Goal> {
  const essentials = await monthlyEssentials(db, settings, today)
  if (!essentials) throw noEssentials()
  try {
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO goals (kind, name, target_cents, color, emergency_months)
       VALUES ('savings', $1, $2, $3, $4) RETURNING id`,
      [
        EMERGENCY_GOAL_NAME,
        targetFor(FIRST_STEP_MONTHS, essentials.cents),
        EMERGENCY_COLOR,
        FIRST_STEP_MONTHS,
      ],
    )
    return getGoal(db, rows[0]!.id, { today, period: periodConfig(settings) })
  } catch (error) {
    if (!isUniqueViolation(error)) throw error
    throw new AppError('conflict', 'You already have an emergency fund goal')
  }
}

/** A change to the emergency fund: the step it aims for, or the accounts it counts. */
export interface EmergencyChange {
  months?: number
  /** The accounts that hold the fund; empty goes back to every savings account. */
  accountIds?: string[]
}

/** Moves the fund to another step, resized from today's essential spending. */
async function setMonths(db: Db, goal: Goal, months: number, essentials: number | null) {
  // Without essentials to size it by, the target scales from where it stands.
  const target = essentials
    ? targetFor(months, essentials)
    : Math.round((goal.targetCents / goal.emergencyMonths!) * months)
  await db.query('UPDATE goals SET emergency_months = $2, target_cents = $3 WHERE id = $1', [
    goal.id,
    months,
    target,
  ])
}

/** Marks the accounts that hold the fund, replacing the ones marked before. */
async function setAccounts(db: Db, goalId: string, accountIds: string[], allowed: Account[]) {
  const unknown = accountIds.filter((id) => !allowed.some((a) => a.id === id))
  if (unknown.length > 0) {
    throw new AppError(
      'invalid_input',
      'An emergency fund can only count checking and savings accounts you can see',
    )
  }
  // Marked accounts take over from one account linked in the goal's form.
  await db.query('UPDATE goals SET account_id = NULL WHERE id = $1', [goalId])
  await db.query('DELETE FROM goal_accounts WHERE goal_id = $1', [goalId])
  await db.query(`INSERT INTO goal_accounts (goal_id, account_id) SELECT $1, unnest($2::uuid[])`, [
    goalId,
    accountIds,
  ])
}

/** Changes the fund's step or accounts. Run it in a transaction, so both land or neither. */
export async function changeEmergencyFund(
  db: Db,
  settings: Settings,
  today: IsoDate,
  change: EmergencyChange,
): Promise<EmergencyFundView> {
  const goal = await emergencyGoal(db, { today, period: periodConfig(settings) })
  if (!goal) throw notFound('Emergency fund goal')
  if (change.months !== undefined) {
    const essentials = await monthlyEssentials(db, settings, today)
    await setMonths(db, goal, change.months, essentials?.cents ?? null)
  }
  if (change.accountIds !== undefined) {
    const candidates = fundCandidates(await listAccounts(db), settings.currency)
    await setAccounts(db, goal.id, [...new Set(change.accountIds)], candidates)
  }
  return (await getEmergencyFund(db, settings, today))!
}
