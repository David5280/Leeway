// Money leaks as account alerts: a charge made more than once, and a
// repeating charge whose price went up. Pure wording: the leaks come in
// already found (duplicates.ts, priceRises.ts), alerts come out.
//
// The words name the merchant and the amounts only, never the account, so no
// account's name or number reaches the inbox, an email or an assistant
// through them. The merchant is named only when leakNames.ts is sure the
// charge is a merchant's, as the app shows it, made safe of every account
// number (safeName.ts). Otherwise the alert names no one: "A payment of $40
// went out twice", "A repeating payment went up". Its charge still opens the
// matching charges in the owner's own activity.

import type { AccountAlert, AlertFormat } from '../accountAlerts.js'
import type { DuplicateCharge } from './duplicates.js'
import type { PriceRise } from './priceRises.js'

/** What a leak alert says about where it happened: the account, and the merchant or null for no one. */
export interface LeakPlace {
  accountName: string
  merchant: string | null
}

/** " on Nov 3" for one day, ", on Nov 3 and Nov 4" for two, " between Nov 3 and Nov 5" for a run. */
function whenWords(charges: DuplicateCharge['charges'], date: AlertFormat['date']): string {
  const first = charges[0]!.date
  const latest = charges.at(-1)!.date
  if (first === latest) return ` on ${date(first)}`
  if (charges.length === 2) return `, on ${date(first)} and ${date(latest)}`
  return ` between ${date(first)} and ${date(latest)}`
}

/**
 * The charge made more than once, in words: "Netflix charged $15.49 twice",
 * "Netflix charged $10, 3 times" (the comma keeps the price and the count
 * apart), or with no merchant "A payment of $40 went out twice".
 */
function chargedWords(merchant: string | null, amount: string, count: number): string {
  const times = count === 2 ? 'twice' : `${count} times`
  if (merchant === null) return `A payment of ${amount} went out ${times}`
  return count === 2
    ? `${merchant} charged ${amount} twice`
    : `${merchant} charged ${amount}, ${times}`
}

/**
 * The alert for a charge made more than once: "Netflix charged $15.49 twice,
 * on Nov 3 and Nov 4.", or "Netflix charged $10, 3 times between Nov 3 and
 * Nov 5.", or with no merchant "A payment of $40 went out twice on Nov 3."
 * It points at the latest of the charges.
 */
export function duplicateAlert(
  duplicate: DuplicateCharge,
  { accountName, merchant }: LeakPlace,
  { money, date }: AlertFormat,
): AccountAlert {
  const { charges } = duplicate
  const latest = charges.at(-1)!
  const charged = chargedWords(merchant, money(latest.amountCents), charges.length)
  return {
    kind: 'duplicate_charge',
    severity: 'warning',
    accountId: duplicate.accountId,
    accountName,
    amountCents: latest.amountCents,
    count: charges.length,
    date: latest.date,
    message: `${charged}${whenWords(charges, date)}.`,
    summary: `${charged}.`,
    charge: { id: latest.id, merchant, previousCents: null },
  }
}

/**
 * The alert for a price rise: "Spotify went up to $11.99, from $10.99.", or
 * with no merchant "A repeating payment went up to $1,650, from $1,500."
 */
export function priceRiseAlert(
  rise: PriceRise,
  { accountName, merchant }: LeakPlace,
  { money }: Pick<AlertFormat, 'money'>,
): AccountAlert {
  const what = merchant ?? 'A repeating payment'
  const sentence = `${what} went up to ${money(rise.charge.amountCents)}, from ${money(rise.previousCents)}.`
  return {
    kind: 'price_rise',
    severity: 'warning',
    accountId: rise.charge.accountId,
    accountName,
    amountCents: rise.charge.amountCents,
    count: 1,
    date: rise.charge.date,
    message: sentence,
    summary: sentence,
    charge: { id: rise.charge.id, merchant, previousCents: rise.previousCents },
  }
}
