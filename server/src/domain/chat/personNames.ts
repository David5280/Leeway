// Which transactions are one person paying another, and which names Chat
// must hide because of them (chat/people.ts reads the rows). Pure.
//
// Privacy comes first: when in doubt, a name is hidden. A name the bank
// wrote after "to" or "from" is always a person's. Plaid's merchant name and
// the bank's line are only kept when the owner's real purchases go by the
// same name, which makes it a shop, not a person.

import { cleanMerchantName, tidyMerchantName } from '../merchantName.js'
import { isAppTransfer, personPayment, type Movement } from '../transfers.js'
import { isKnownShop, type KnownShops } from './knownShops.js'
import { loneNamesOf } from './loneNames.js'
import { namesSomeone } from './movementWords.js'

/** Plaid's merchant name made readable, or an empty string when it gave none. */
function merchantOf(tx: Movement): string {
  return tx.merchantName?.trim() ? tidyMerchantName(tx.merchantName) : ''
}

/**
 * Whether a transaction is one person paying another. A payment app alone
 * is not enough: "PAYPAL *SPOTIFY" is a shop paid through PayPal. It also
 * needs the bank's line to name the person, or Plaid to file it as money
 * sent to people. Any transfer code does for the apps people use to pay each
 * other. PayPal pays shops by transfer too ("PAYPAL INST XFER" to eBay), so
 * there a bare transfer is a person's only when its merchant could be one
 * and is no shop the owner buys from.
 */
export function isPersonPayment(tx: Movement, shops: KnownShops): boolean {
  const person = personPayment(tx)
  if (!person) return false
  if (person.counterparty !== null || isAppTransfer(tx)) return true
  const code = tx.providerCategoryDetailed ?? tx.providerCategoryPrimary ?? ''
  if (!code.startsWith('TRANSFER')) return false
  if (person.app !== 'PayPal') return true
  const merchant = merchantOf(tx)
  return namesSomeone(merchant) && !isKnownShop(shops, merchant)
}

/** The names one payment between people could show its person under. */
export interface PaymentNames {
  /** The name the bank wrote after "to" or "from": always a person's. */
  counterparty: string[]
  /** Plaid's merchant name, where it often puts the person. */
  merchant: string[]
  /** The readable name made from the bank's whole line, as in "Zelle To Jane Doe". */
  line: string[]
}

/** Where one payment between people could show its person. */
export function namesIn(tx: Movement): PaymentNames {
  const only = (name: string) => [name].filter(namesSomeone)
  return {
    counterparty: only(personPayment(tx)?.counterparty ?? ''),
    merchant: only(merchantOf(tx)),
    line: only(cleanMerchantName(tx.name)),
  }
}

/** The names Chat hides, and where. */
export interface HiddenNames {
  /** Hidden wherever they are written, in any case. */
  names: string[]
  /** Parts of those names hidden only where written alone, capitalized, in a note. */
  loneNames: string[]
}

/**
 * The names Chat hides, from the names payments between people showed and
 * the shops the owner buys from:
 *
 * - A name after "to" or "from" is always hidden.
 * - A merchant name or bank line is hidden unless it is a known shop's whole name.
 * - The given name and surname of each hidden person (not of a bank line)
 *   are hidden alone in notes, unless common words or how a shop is called
 *   (loneNames.ts).
 */
export function namesToHide(found: PaymentNames, shops: KnownShops): HiddenNames {
  const notShop = (name: string) => !isKnownShop(shops, name)
  const people = [...new Set([...found.counterparty, ...found.merchant.filter(notShop)])]
  return {
    names: [...new Set([...people, ...found.line.filter(notShop)])],
    loneNames: loneNamesOf(people, shops),
  }
}
