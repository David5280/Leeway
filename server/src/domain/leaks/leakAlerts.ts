// Money leaks as account alerts: a charge made more than once, and a
// repeating charge whose price went up. Pure wording: the leaks come in
// already found (duplicates.ts, priceRises.ts), alerts come out.
//
// The words name the merchant and the amounts only, never the account, so no
// account's name or number reaches the inbox, an email or an assistant
// through them. The merchant is the name the app shows, made safe of every
// account number (safeName.ts).

import type { AccountAlert, AlertFormat } from '../accountAlerts.js'
import type { DuplicateCharge } from './duplicates.js'
import type { PriceRise } from './priceRises.js'

/** "$15.49 twice", or "$10, 3 times": the comma keeps the price and the count apart. */
const amountTimes = (amount: string, count: number) =>
  count === 2 ? `${amount} twice` : `${amount}, ${count} times`

/** " on Nov 3" for one day, ", on Nov 3 and Nov 4" for two, " between Nov 3 and Nov 5" for a run. */
function whenWords(charges: DuplicateCharge['charges'], date: AlertFormat['date']): string {
  const first = charges[0]!.date
  const latest = charges.at(-1)!.date
  if (first === latest) return ` on ${date(first)}`
  if (charges.length === 2) return `, on ${date(first)} and ${date(latest)}`
  return ` between ${date(first)} and ${date(latest)}`
}

/**
 * The alert for a charge made more than once: "Netflix charged $15.49 twice,
 * on Nov 3 and Nov 4.", or "Netflix charged $10, 3 times between Nov 3 and
 * Nov 5." It points at the latest of the charges.
 */
export function duplicateAlert(
  duplicate: DuplicateCharge,
  { accountName, merchant }: { accountName: string; merchant: string },
  { money, date }: AlertFormat,
): AccountAlert {
  const { charges } = duplicate
  const latest = charges.at(-1)!
  const charged = `${merchant} charged ${amountTimes(money(latest.amountCents), charges.length)}`
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

/** The alert for a price rise: "Spotify went up to $11.99, from $10.99." */
export function priceRiseAlert(
  rise: PriceRise,
  accountName: string,
  { money }: Pick<AlertFormat, 'money'>,
): AccountAlert {
  const sentence = `${rise.name} went up to ${money(rise.charge.amountCents)}, from ${money(rise.previousCents)}.`
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
    charge: { id: rise.charge.id, merchant: rise.name, previousCents: rise.previousCents },
  }
}
