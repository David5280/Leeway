// The emergency fund goal: offered in one tap when there is none, sized from
// real essential spending (one month first, then three, then six), and
// following the savings accounts the owner marks for it, or every savings
// account no other goal follows until they do. A goal the owner already named
// as an emergency fund is taken as the fund instead of offering a second.
// Recording progress never moves money.

import type { Db } from '../db/pool.js'
import { AppError, isUniqueViolation, notFound } from '../errors.js'
import type { IsoDate } from '../lib/dates.js'
import { listAccounts } from './accounts.js'
import {
  accountsOtherGoalsFollow,
  EMERGENCY_GOAL_NAME,
  findFund,
  FIRST_STEP_MONTHS,
  followedAlready,
  fundCandidates,
  monthsOf,
  targetFor,
} from './emergencyPlan.js'
import { emergencyView, type EmergencyFundView } from './emergencyView.js'
import { essentialsOf, fundState, stateOf } from './goalFunds.js'
import { goalReading, type Goal } from './goalProgress.js'
import { getGoal, listGoals } from './goals.js'
import type { MonthlyEssentials } from './monthlyEssentials.js'
import type { Settings } from './settings.js'

/**
 * The color a new emergency fund is drawn in: the color picker's Aqua
 * (CATEGORY_COLORS in web/src/lib/theme.ts), so its form shows it picked, and
 * no starter category's color (Travel's teal included). Never the red kept
 * for problems.
 */
const EMERGENCY_COLOR = '#1BA876'

/** What a fund that is not marked yet has stored: nothing marked, and the target it was given. */
const NOTHING_STORED = { markedIds: [], otherGoalAccountIds: [], ownTarget: true }

/**
 * The emergency fund: the goal once there is one, or the one-tap offer when
 * there is none. Null when there is no fund and essential spending is not
 * known yet, since there is nothing to size an offer by.
 */
export async function getEmergencyFund(
  db: Db,
  settings: Settings,
  today: IsoDate,
): Promise<EmergencyFundView | null> {
  // One reading, so what the goals list read of the fund is not read again here.
  const reading = goalReading(settings, today)
  // One at a time: db may be a transaction's client, which runs one query at once.
  const goals = await listGoals(db, reading)
  const fund = findFund(goals)
  const { essentials, choice } = await essentialsOf(db, reading)
  const accounts = await listAccounts(db)
  const marked = fund !== null && fund.emergencyMonths !== null
  const state = marked ? await stateOf(db, reading, fund.id) : NOTHING_STORED
  return emergencyView({ goals, essentials, choice, accounts, state, settings })
}

const noEssentials = () =>
  new AppError(
    'invalid_input',
    'Leeway needs a month of spending, or a bill, to size an emergency fund. Try again after your bank has synced a month.',
  )

const alreadyHave = (name: string) =>
  new AppError('conflict', `${name} is already your emergency fund`)

/** Starts the emergency fund goal at one month of essential spending. */
export async function startEmergencyFund(
  db: Db,
  settings: Settings,
  today: IsoDate,
): Promise<Goal> {
  const reading = goalReading(settings, today)
  const existing = findFund(await listGoals(db, reading))
  if (existing) throw alreadyHave(existing.name)
  const { essentials } = await essentialsOf(db, reading)
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
    // INSERT ... RETURNING gives back the one row it made.
    return getGoal(db, rows[0]!.id, reading)
  } catch (error) {
    // Two taps at once: the second meets the one-fund index.
    if (!isUniqueViolation(error)) throw error
    throw alreadyHave(EMERGENCY_GOAL_NAME)
  }
}

/** A change to the emergency fund: the step it aims for, or the accounts it counts. */
export interface EmergencyChange {
  months?: number
  /** The accounts that hold the fund; empty goes back to every savings account. */
  accountIds?: string[]
  /** Count the fund by hand again, from the count it kept, instead of from accounts. */
  byHand?: boolean
}

/** The whole months, within what a fund can aim for, nearest to some months. */
const wholeMonths = (months: number) => Math.min(24, Math.max(1, Math.round(months)))

/**
 * Marks a goal named as an emergency fund as the fund, keeping everything it
 * had: its target as the owner's own, and its count by hand or its one
 * account. Done once the owner first changes it, so it never changes on its
 * own. Returns the months its target is, roughly, which a later step scales from.
 */
async function adopt(db: Db, fund: Goal, essentials: MonthlyEssentials | null): Promise<number> {
  const months = essentials ? wholeMonths(monthsOf(fund.targetCents, essentials.cents)) : 1
  // Only a named goal with no marked fund beside it is adopted (findFund
  // prefers the marked one), and starting a fund refuses while one is named,
  // so the one-fund index has nothing to catch here.
  await db.query(
    `UPDATE goals SET emergency_months = $2, emergency_own_target = true,
       emergency_by_hand = account_id IS NULL
     WHERE id = $1`,
    [fund.id, months],
  )
  return months
}

/**
 * Moves the fund to another step, sized from today's essential spending, so
 * its target is months of essentials again rather than an amount of its own.
 */
async function setMonths(
  db: Db,
  fund: { id: string; targetCents: number; months: number },
  months: number,
  essentials: MonthlyEssentials | null,
) {
  // Without essentials to size it by, the target scales from where it stands.
  const target = essentials
    ? targetFor(months, essentials.cents)
    : Math.round((fund.targetCents / fund.months) * months)
  await db.query(
    `UPDATE goals SET emergency_months = $2, target_cents = $3, emergency_own_target = false
     WHERE id = $1`,
    [fund.id, months, target],
  )
}

/** What the fund may count when its accounts change. */
interface AccountRules {
  /** Checking and savings accounts that can hold the fund now. */
  candidates: string[]
  /** Accounts the fund counts already, which stay allowed even if hidden since. */
  current: string[]
  /** Accounts other goals follow, by id, with the goal's name. */
  otherGoals: Map<string, string>
}

/** Refuses any newly marked account the fund can't count. */
function checkAccounts(accountIds: string[], rules: AccountRules) {
  for (const id of accountIds.filter((one) => !rules.current.includes(one))) {
    const otherGoal = rules.otherGoals.get(id)
    if (otherGoal !== undefined) {
      throw new AppError('invalid_input', followedAlready(otherGoal))
    }
    if (!rules.candidates.includes(id)) {
      throw new AppError(
        'invalid_input',
        'An emergency fund can only count checking and savings accounts you can see',
      )
    }
  }
}

/**
 * Marks the accounts that hold the fund, replacing the ones marked before and
 * any one account linked in the goal's form or count by hand.
 */
async function setAccounts(db: Db, goalId: string, accountIds: string[], rules: AccountRules) {
  checkAccounts(accountIds, rules)
  await db.query('UPDATE goals SET account_id = NULL, emergency_by_hand = false WHERE id = $1', [
    goalId,
  ])
  await db.query('DELETE FROM goal_accounts WHERE goal_id = $1', [goalId])
  // Two saves of the same accounts at once: the second waits for the first,
  // then finds its rows there already, rather than failing.
  await db.query(
    `INSERT INTO goal_accounts (goal_id, account_id) SELECT $1, unnest($2::uuid[])
     ON CONFLICT DO NOTHING`,
    [goalId, accountIds],
  )
}

/** Counts the fund by hand again, from the count it kept, rather than from accounts. */
async function setByHand(db: Db, goalId: string) {
  await db.query('UPDATE goals SET account_id = NULL, emergency_by_hand = true WHERE id = $1', [
    goalId,
  ])
  await db.query('DELETE FROM goal_accounts WHERE goal_id = $1', [goalId])
}

/**
 * Changes the fund's step, its accounts, or back to its count by hand. Run it
 * in a transaction, so every part lands or none does.
 */
export async function changeEmergencyFund(
  db: Db,
  settings: Settings,
  today: IsoDate,
  change: EmergencyChange,
): Promise<EmergencyFundView> {
  // Which goal is the fund, and whether it is marked yet, depends on every
  // goal, so a change locks them all (a handful of rows) before reading:
  // two changes at once then run one after the other, and the second sees a
  // named goal the first marked as the fund instead of marking it again.
  await db.query('SELECT id FROM goals ORDER BY id FOR UPDATE')
  const reading = goalReading(settings, today)
  // One at a time: db may be a transaction's client, which runs one query at once.
  const goals = await listGoals(db, reading)
  const fund = findFund(goals)
  if (!fund) throw notFound('Emergency fund goal')
  const { essentials } = await essentialsOf(db, reading)
  const months = fund.emergencyMonths ?? (await adopt(db, fund, essentials))
  if (change.months !== undefined) {
    await setMonths(
      db,
      { id: fund.id, targetCents: fund.targetCents, months },
      change.months,
      essentials,
    )
  }
  if (change.byHand) await setByHand(db, fund.id)
  if (change.accountIds !== undefined) {
    const { markedIds } = await fundState(db, fund.id)
    const linked = fund.accountId === null ? [] : [fund.accountId]
    await setAccounts(db, fund.id, [...new Set(change.accountIds)], {
      candidates: fundCandidates(await listAccounts(db), settings.currency).map((a) => a.id),
      current: [...markedIds, ...linked],
      otherGoals: accountsOtherGoalsFollow(goals, fund.id),
    })
  }
  const view = await getEmergencyFund(db, settings, today)
  // The fund was found above, so there is always one to show.
  if (view === null) throw notFound('Emergency fund goal')
  return view
}
