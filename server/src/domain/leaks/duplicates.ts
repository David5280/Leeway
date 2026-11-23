// Duplicate charges: the same merchant charging the same amount to the same
// account more than once within a few days. Pure: posted charges come in,
// the clusters worth a look come out; leakSource.ts reads them.
//
// Only what the data supports is flagged. A pending line and the posted line
// it became are one charge, so only posted charges are read. A routine
// purchase (the same coffee most mornings, a weekly class, a payment split in
// equal parts every month) is a habit, not a duplicate: the merchant charges
// that amount often, or has charged it twice close together before. A
// monthly subscription charged twice in a few days is neither, so it shows.
// Each refund since a cluster began puts one of its charges right, so a
// charge made twice and refunded once is settled, while one made three times
// and refunded once is still a charge made twice.
//
// A habit is judged over the HABIT_DAYS before the cluster's first charge,
// ending there: nothing on or after that day counts, so the same charges read
// the same way all the while they are news, however many come after them.
//
// Lines the owner made or the bank charged (cash, checks, payments to people,
// transfers, bank fees) never reach here: merchantCharges.ts leaves them out.

import { addDays, daysBetween, type IsoDate } from '../../lib/dates.js'
import { merchantKey } from '../merchantKey.js'

/** Charges this many days apart or closer, at one merchant for one amount, may be one charge twice. */
export const DUPLICATE_DAYS = 3

/** How long a duplicate stays news: about one statement. */
export const DUPLICATE_NEWS_DAYS = 30

/** History before a cluster that tells a habit from a duplicate. */
export const HABIT_DAYS = 90

/**
 * History read: back to the habit window of the oldest cluster still news,
 * which began up to DUPLICATE_DAYS before its latest charge.
 */
export const DUPLICATE_HISTORY_DAYS = HABIT_DAYS + DUPLICATE_NEWS_DAYS + DUPLICATE_DAYS

/** Days at the same merchant and amount within HABIT_DAYS before a cluster that make it a habit: about weekly. */
const HABIT_OTHER_DAYS = 4

/** A posted charge or refund, as the leak checks read it. Positive is money out. */
export interface ChargeLine {
  id: string
  accountId: string
  date: IsoDate
  name: string
  merchantName: string | null
  amountCents: number
}

/** Charges that look like one charge made more than once, oldest first (at least two). */
export interface DuplicateCharge {
  accountId: string
  charges: ChargeLine[]
}

/** One account, merchant and amount: the charges a duplicate is looked for among. */
const groupKey = (line: ChargeLine) => `${line.accountId}|${merchantKey(line)}|${line.amountCents}`

/** Groups money out by account, merchant and amount, each oldest first. */
function groupCharges(lines: ChargeLine[]): ChargeLine[][] {
  const groups = new Map<string, ChargeLine[]>()
  for (const line of lines) {
    if (line.amountCents <= 0 || !merchantKey(line)) continue
    const key = groupKey(line)
    const group = groups.get(key)
    if (group) group.push(line)
    else groups.set(key, [line])
  }
  return [...groups.values()].map((group) =>
    group.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id)),
  )
}

/** Runs of two or more charges, oldest first, each spanning DUPLICATE_DAYS or fewer from its first. */
function clustersOf(group: ChargeLine[]): ChargeLine[][] {
  const clusters: ChargeLine[][] = []
  for (const charge of group) {
    const current = clusters.at(-1)
    if (current && daysBetween(current[0]!.date, charge.date) <= DUPLICATE_DAYS) {
      current.push(charge)
    } else {
      clusters.push([charge])
    }
  }
  return clusters.filter((cluster) => cluster.length > 1)
}

/**
 * Whether charging this amount is routine at this merchant, judged from the
 * HABIT_DAYS before the cluster's first charge, up to that day and not on it:
 * charged on enough days then, or twice close together then too.
 */
function isHabit(group: ChargeLine[], cluster: ChargeLine[]): boolean {
  const first = cluster[0]!.date
  const from = addDays(first, -HABIT_DAYS)
  const before = group.filter((charge) => charge.date >= from && charge.date < first)
  if (clustersOf(before).length > 0) return true
  return new Set(before.map((charge) => charge.date)).size >= HABIT_OTHER_DAYS
}

/**
 * The cluster less one charge for each refund of its amount from its merchant
 * on its account since it began. Charges come off the oldest end, so what is
 * left still points at the latest charge, as the alert did before the refund.
 */
function lessRefunds(cluster: ChargeLine[], refunds: ChargeLine[]): ChargeLine[] {
  const first = cluster[0]!
  const refunded = refunds.filter(
    (refund) =>
      refund.accountId === first.accountId &&
      refund.amountCents === -first.amountCents &&
      refund.date >= first.date &&
      merchantKey(refund) === merchantKey(first),
  ).length
  return cluster.slice(refunded)
}

/** Newest first, by each duplicate's latest charge. */
const newestFirst = (a: DuplicateCharge, b: DuplicateCharge) =>
  b.charges.at(-1)!.date.localeCompare(a.charges.at(-1)!.date)

/**
 * Every charge made more than once whose latest charge is still news
 * (DUPLICATE_NEWS_DAYS), refunded or not, newest first. A bill paid twice is
 * told once by these (doublePaidBills.ts), the refunded ones too. `lines` are
 * posted charges and refunds from the last DUPLICATE_HISTORY_DAYS, transfers
 * between the owner's own accounts left out.
 */
export function findDoubleCharges(lines: ChargeLine[], today: IsoDate): DuplicateCharge[] {
  const since = addDays(today, -DUPLICATE_NEWS_DAYS)
  return groupCharges(lines)
    .flatMap((group) =>
      clustersOf(group)
        .filter((cluster) => cluster.at(-1)!.date > since)
        .filter((cluster) => !isHabit(group, cluster))
        .map((charges) => ({ accountId: charges[0]!.accountId, charges })),
    )
    .sort(newestFirst)
}

/**
 * Every likely duplicate still news, newest first: the double charges with
 * the refunded charges taken off, while two or more are left.
 */
export function findDuplicates(lines: ChargeLine[], today: IsoDate): DuplicateCharge[] {
  const refunds = lines.filter((line) => line.amountCents < 0)
  return findDoubleCharges(lines, today)
    .map((duplicate) => ({ ...duplicate, charges: lessRefunds(duplicate.charges, refunds) }))
    .filter((duplicate) => duplicate.charges.length > 1)
}
