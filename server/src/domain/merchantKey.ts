// A merchant's name reduced to what stays the same between charges, so repeat
// charges group together, a bill's pattern finds the payments and a pending
// charge finds the one it became. Pure.

/**
 * The merchant name reduced to its words: "NETFLIX.COM 8473 CA" and
 * "Netflix.com 1192 CA" both become "netflix com ca". The bank's merchant
 * name is read where it gave one, else its description. The SQL function
 * merchant_key() (migration 003) does the same for bills that read bank text.
 */
export function merchantKey(tx: { merchantName: string | null; name: string }): string {
  return textKey(tx.merchantName ?? tx.name)
}

/** Any text reduced the same way: lower case, letters only, words split by single spaces. */
export function textKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/[0-9#*]+/g, ' ')
    .replace(/[^a-z]+/g, ' ')
    .trim()
}

/**
 * Leading words that name a payment processor or how the card was used, not
 * the merchant: "SQ *BLUE BOTTLE" is Blue Bottle, "POS PURCHASE SHELL" is
 * Shell. Skipped before a description's first word is read as the merchant.
 */
export const NAMELESS_PREFIXES: ReadonlySet<string> = new Set([
  'sq', // Square
  'tst', // Toast
  'sp', // Shopify
  'paypal',
  'pos',
  'purchase',
  'debit',
  'card',
  'checkcard',
  'ach',
  'the',
])

/** The first word of a name that names the merchant, or '' when none does. */
export function merchantWord(text: string): string {
  const words = textKey(text).split(' ')
  return words.find((word) => word !== '' && !NAMELESS_PREFIXES.has(word)) ?? ''
}

/**
 * Whether two charges read as the same merchant: the first merchant word of
 * either one's merchant name or description is the first of the other's, so
 * "Best Buy" is "Best Buy Co" and "POS PURCHASE SHELL" is "Shell", while
 * "SQ *BLUE BOTTLE" is not "SQ *CORNER BAKERY". Loose on purpose: it only
 * rules out a charge that otherwise fits by account, amount and date.
 */
export function sameMerchant(
  a: { merchantName: string | null; name: string },
  b: { merchantName: string | null; name: string },
): boolean {
  const words = (tx: typeof a) =>
    [tx.merchantName ?? '', tx.name].map(merchantWord).filter((word) => word !== '')
  const theirs = new Set(words(b))
  return words(a).some((word) => theirs.has(word))
}
