// The shops the owner really buys from, as Chat's privacy rules ask about
// them (chat/people.ts finds them). Pure.

/** The owner's shops, by whole name and by first word, in lower case. */
export interface KnownShops {
  names: ReadonlySet<string>
  firstWords: ReadonlySet<string>
}

/** No purchases seen: no name is a known shop. */
export const NO_SHOPS: KnownShops = { names: new Set(), firstWords: new Set() }

/** The first word of a name as written, punctuation and all: "Wendy's" for "Wendy's Grill". */
function firstWordOf(name: string): string {
  return name.trim().split(/\s+/)[0]!.toLowerCase()
}

/** Known shops from the merchant names of the owner's purchases. */
export function knownShops(merchants: readonly string[]): KnownShops {
  const named = merchants.filter((name) => name.trim())
  return {
    names: new Set(named.map((name) => name.trim().toLowerCase())),
    firstWords: new Set(named.map(firstWordOf)),
  }
}

/** Whether a name is a known shop's whole name, in any case. */
export function isKnownShop(shops: KnownShops, name: string): boolean {
  return shops.names.has(name.trim().toLowerCase())
}

/**
 * Whether a single word is how a known shop is called: its whole name
 * ("Marigold") or the word it starts with ("Marigold Bakery"). A shop that
 * only has the word inside it, or with more attached ("Wendy's"), does not count.
 */
export function startsAShop(shops: KnownShops, word: string): boolean {
  const lower = word.toLowerCase()
  return shops.names.has(lower) || shops.firstWords.has(lower)
}
