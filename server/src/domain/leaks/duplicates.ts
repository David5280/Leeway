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
// A cluster one of whose charges was refunded is already put right.

import { addDays, daysBetween, type IsoDate } from '../../lib/dates.js'
import { merchantKey } from '../merchantKey.js'

/** Charges this many days apart or closer, at one merchant for one amount, may be one charge twice. */
export const DUPLICATE_DAYS = 3

/** How long a duplicate stays news: about one statement. */
export const DUPLICATE_NEWS_DAYS = 30

/** History read to tell a habit from a duplicate. */
export const HABIT_DAYS = 90

/** Other days at the same merchant and amount within HABIT_DAYS that make it a habit: about weekly. */
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
    groups.set(key, [...(groups.get(key) ?? []), line])
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
 * Whether charging this amount is routine at this merchant: on enough other
 * days lately, or twice close together more than once (`runs` are every
 * cluster in the group).
 */
function isHabit(group: ChargeLine[], cluster: ChargeLine[], runs: number): boolean {
  if (runs > 1) return true
  const inCluster = new Set(cluster.map((charge) => charge.date))
  const otherDays = new Set(group.map((charge) => charge.date).filter((d) => !inCluster.has(d)))
  return otherDays.size >= HABIT_OTHER_DAYS
}

/** Whether a refund of the same amount from the same merchant came on or after the cluster began. */
function wasRefunded(cluster: ChargeLine[], refunds: ChargeLine[]): boolean {
  const first = cluster[0]!
  return refunds.some(
    (refund) =>
      refund.accountId === first.accountId &&
      refund.amountCents === -first.amountCents &&
      refund.date >= first.date &&
      merchantKey(refund) === merchantKey(first),
  )
}

/**
 * Every likely duplicate whose latest charge is still news (DUPLICATE_NEWS_DAYS),
 * newest first. `lines` are posted charges and refunds from the last
 * HABIT_DAYS, transfers between the owner's own accounts left out.
 */
export function findDuplicates(lines: ChargeLine[], today: IsoDate): DuplicateCharge[] {
  const since = addDays(today, -DUPLICATE_NEWS_DAYS)
  const refunds = lines.filter((line) => line.amountCents < 0)
  return groupCharges(lines)
    .flatMap((group) => {
      const clusters = clustersOf(group)
      return clusters
        .filter((cluster) => cluster.at(-1)!.date > since)
        .filter((cluster) => !isHabit(group, cluster, clusters.length))
        .filter((cluster) => !wasRefunded(cluster, refunds))
        .map((charges) => ({ accountId: charges[0]!.accountId, charges }))
    })
    .sort((a, b) => b.charges.at(-1)!.date.localeCompare(a.charges.at(-1)!.date))
}
