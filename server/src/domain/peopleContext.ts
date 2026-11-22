// The shops the owner buys from, which telling a payment between people and
// hiding names read (betweenPeople.ts, chat/personNames.ts): a shop's name
// is never hidden as a person's. Only a row a model may see by name
// (modelLabels.ts) makes its merchant a shop, so a labelled one never does:
// paying "ODALYS LARKSPUR" for services never makes "Larkspur" a shop's word.
// Pure.

import { merchantOf } from './betweenPeople.js'
import { knownShops, type KnownShops } from './knownShops.js'
import { neutralLabel, type LabelSubject } from './modelLabels.js'

/** Whether a row is a purchase at a shop: money out, at a merchant Plaid named, shown by name. */
function isShopPurchase(tx: LabelSubject): boolean {
  return tx.amountCents > 0 && merchantOf(tx) !== '' && neutralLabel(tx) === null
}

/** The shops among some rows: the merchants of their purchases (isShopPurchase). */
export function shopsIn(rows: readonly LabelSubject[]): KnownShops {
  return knownShops(rows.filter(isShopPurchase).map(merchantOf))
}
