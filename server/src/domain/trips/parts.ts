// The four parts a trip's money goes to (getting there, a place to stay,
// food, and things to do), told from each transaction's bank category, its
// category in Leeway and, for places to stay, its merchant. Pure.

export const TRIP_PARTS = ['travel', 'stay', 'food', 'activities'] as const

export type TripPart = (typeof TRIP_PARTS)[number]

export interface Partable {
  providerCategoryPrimary: string | null
  providerCategoryDetailed: string | null
  categoryName: string | null
  merchant: string
}

/** Merchants that are a place to stay, whatever the bank filed them under. */
const STAY_WORDS =
  /\b(hotel|motel|inn|suites|resort|lodge|hostel|airbnb|vrbo|booking\.com|expedia|marriott|hilton|hyatt|sheraton|westin|holiday inn|best western)\b/i
const FOOD_NAMES = /^(dining|groceries|fast food|coffee|restaurants?|food)/i
const TRAVEL_NAMES = /^(travel|transportation|gas|getting around|parking)/i

/** Which part of a trip a transaction belongs to. Anything else is something to do. */
export function partOf(tx: Partable): TripPart {
  const detailed = tx.providerCategoryDetailed ?? ''
  if (detailed === 'TRAVEL_LODGING' || STAY_WORDS.test(tx.merchant)) return 'stay'
  if (tx.providerCategoryPrimary === 'FOOD_AND_DRINK' || FOOD_NAMES.test(tx.categoryName ?? '')) {
    return 'food'
  }
  if (
    tx.providerCategoryPrimary === 'TRAVEL' ||
    tx.providerCategoryPrimary === 'TRANSPORTATION' ||
    TRAVEL_NAMES.test(tx.categoryName ?? '')
  ) {
    return 'travel'
  }
  return 'activities'
}
