// Pending charges set aside when their account came back under a new
// account_id (see returnedHistory.ts). Plaid sends the account's charges
// again under new ids, so the pending row goes, but what the owner set on it
// waits in held_charges, out of every total and list, for the one charge it
// can only have become. That charge may arrive in any sync of the window,
// first pending under its new id or already posted.
//
// Each sync weighs every charge on the account that came in since the hold
// began, not only that sync's arrivals, since a charge saved in an earlier
// sync can become the one that fits later, as when the bank changes a
// pending amount. A pending charge and the posted one replacing it count
// once. A held charge with exactly one such charge, that no other held charge
// could be either, pairs with it. One with more is let go, carrying nothing,
// since its charge cannot be told for sure; deleting it is what keeps a
// doubt from being forgotten when one of the charges behind it posts or goes.

import type pg from 'pg'
import { addDays, type IsoDate } from '../lib/dates.js'
import { sameMerchant } from './merchantKey.js'
import { CHARGE_SUBJECT } from './notifications/sources.js'

/** How many days after a pending charge its posted charge may be dated and still be it. */
export const POSTING_DAYS = 7

/** A bank charge as weighed against a held one: where, when, how much and named what. */
export interface CurrentCharge {
  id: string
  accountId: string
  date: IsoDate
  amountCents: number
  name: string
  merchantName: string | null
  createdAt: Date
}

/** A pending charge set aside when its account came back, with what the owner set on it. */
export interface HeldCharge extends Omit<CurrentCharge, 'createdAt'> {
  /** The category, only when the owner picked it by hand. */
  categoryId: string | null
  note: string | null
  excluded: boolean
  /** Its large-charge notification's subject. */
  subject: string
  heldAt: Date
}

/** What becomes of the held charges in one sync. */
export interface HeldOutcome {
  /** The current charge each held charge became, keyed by the held charge's id. */
  pairs: Map<string, string>
  /** Held charges more than one current charge could be, or that share theirs. */
  doubtful: string[]
}

/** Sets aside the pending charges of accounts that came back, until `days` from now. */
export async function holdPendingCharges(
  db: pg.PoolClient,
  accountIds: string[],
  days: number,
): Promise<void> {
  await db.query(
    `WITH gone AS (
       DELETE FROM transactions t WHERE t.account_id = ANY($1::uuid[]) AND t.pending
       RETURNING t.account_id, t.date, t.amount_cents, t.name, t.merchant_name,
         CASE WHEN t.category_source = 'manual' THEN t.category_id END AS category_id,
         t.note, t.excluded, ${CHARGE_SUBJECT} AS subject
     )
     INSERT INTO held_charges (account_id, date, amount_cents, name, merchant_name,
       category_id, note, excluded, subject, held_at, held_until)
     SELECT account_id, date, amount_cents, name, merchant_name, category_id, note, excluded,
       subject, now(), now() + make_interval(days => $2)
     FROM gone`,
    [accountIds, days],
  )
}

/** Lets go of a connection's held charges whose window has run out. */
export async function dropExpiredHolds(db: pg.PoolClient, connectionId: string): Promise<void> {
  await db.query(
    `DELETE FROM held_charges h USING accounts a
     WHERE a.id = h.account_id AND a.connection_id = $1 AND h.held_until <= now()`,
    [connectionId],
  )
}

/**
 * Weighs each held charge against the current charges it can be: on the same
 * account, in since its hold began, for the same amount at the same merchant,
 * dated that day or up to POSTING_DAYS later. Guessing could put the owner's
 * note on the wrong charge, so only a held charge with one such charge, that
 * no other held charge could be, pairs; one with more is doubtful, and one
 * with none waits.
 */
export function pairHeldCharges(held: HeldCharge[], current: CurrentCharge[]): HeldOutcome {
  const fits = (pending: HeldCharge, charge: CurrentCharge) =>
    charge.accountId === pending.accountId &&
    charge.createdAt.getTime() >= pending.heldAt.getTime() &&
    charge.amountCents === pending.amountCents &&
    charge.date >= pending.date &&
    charge.date <= addDays(pending.date, POSTING_DAYS) &&
    sameMerchant(pending, charge)
  const choices = held.map((pending) => current.filter((charge) => fits(pending, charge)))
  const claims = new Map<string, number>()
  for (const charge of choices.flat()) claims.set(charge.id, (claims.get(charge.id) ?? 0) + 1)
  const outcome: HeldOutcome = { pairs: new Map(), doubtful: [] }
  choices.forEach((fitting, index) => {
    const { id } = held[index]!
    if (fitting.length === 1 && claims.get(fitting[0]!.id) === 1) {
      outcome.pairs.set(id, fitting[0]!.id)
    } else if (fitting.length > 0) {
      outcome.doubtful.push(id)
    }
  })
  return outcome
}

const CHARGE_COLUMNS = `id, account_id AS "accountId", date, amount_cents AS "amountCents", name,
  merchant_name AS "merchantName"`

/**
 * After a sync has saved and removed what the bank sent: pairs the
 * connection's held charges, carries what the owner set on each paired one
 * over to the charge it became, and lets go of those and the doubtful ones.
 * Returns each charge carried to, with the notification subject it took over.
 */
export async function settleHeldCharges(
  db: pg.PoolClient,
  connectionId: string,
): Promise<{ id: string; subject: string }[]> {
  const { rows: held } = await db.query<HeldCharge>(
    `SELECT ${CHARGE_COLUMNS}, category_id AS "categoryId", note, excluded, subject,
       held_at AS "heldAt"
     FROM held_charges h
     WHERE h.held_until > now()
       AND h.account_id IN (SELECT id FROM accounts WHERE connection_id = $1)`,
    [connectionId],
  )
  if (held.length === 0) return []
  // A pending charge the posted one replacing it already points at is that
  // same charge, and is left out so the charge counts once.
  const { rows: current } = await db.query<CurrentCharge>(
    `SELECT ${CHARGE_COLUMNS}, created_at AS "createdAt"
     FROM transactions t
     WHERE t.account_id = ANY($1::uuid[]) AND t.provider_transaction_id IS NOT NULL
       AND t.created_at >= $2
       AND NOT EXISTS (SELECT 1 FROM transactions posted
         WHERE posted.account_id = t.account_id
           AND posted.pending_provider_transaction_id = t.provider_transaction_id)`,
    [[...new Set(held.map((charge) => charge.accountId))], earliest(held)],
  )
  const { pairs, doubtful } = pairHeldCharges(held, current)
  const carried = held.flatMap((charge) => {
    const to = pairs.get(charge.id)
    return to ? [{ ...charge, to }] : []
  })
  await carryEdits(db, carried)
  await db.query('DELETE FROM held_charges WHERE id = ANY($1::uuid[])', [
    [...pairs.keys(), ...doubtful],
  ])
  return carried.map(({ to, subject }) => ({ id: to, subject }))
}

const earliest = (held: HeldCharge[]) =>
  new Date(Math.min(...held.map((charge) => charge.heldAt.getTime())))

/**
 * What the owner set on each pending charge, onto the charge it became, as
 * when one posts (sync.ts).
 */
async function carryEdits(db: pg.PoolClient, carried: (HeldCharge & { to: string })[]) {
  if (carried.length === 0) return
  await db.query(
    `UPDATE transactions t SET
       category_id = coalesce(c.category_id, t.category_id),
       category_source = CASE WHEN c.category_id IS NULL THEN t.category_source ELSE 'manual' END,
       note = coalesce(t.note, c.note),
       excluded = t.excluded OR c.excluded
     FROM unnest($1::uuid[], $2::uuid[], $3::text[], $4::boolean[])
       AS c(id, category_id, note, excluded)
     WHERE t.id = c.id`,
    [
      carried.map((row) => row.to),
      carried.map((row) => row.categoryId),
      carried.map((row) => row.note),
      carried.map((row) => row.excluded),
    ],
  )
}
